// Require
// --------------------------------------------

var helpers = require('./helpers/helpers');
var fileHelpers = require('./helpers/file');
var pluginHelpers = require('./helpers/plugin');
var htmlbookHelpers = require('./helpers/htmlbook');

var _ = require('lodash');
var fs = require('fs');
var vfs = require('vinyl-fs');
var through = require('through2');
var MarkdownIt = require('markdown-it')
var gutil = require('gulp-util');
var tinyliquid = require('tinyliquid');
var path = require('path');

// Variables
// --------------------------------------------

var pluginsCache = {};
var layoutCache = {};

var defaults = {
  "verbose" : true,
  "files" : "content/*.md",
  "destination" : "build/:build",
  "plugins" : ["frontmatter", "ids", "toc", "katex", "links", "images", "stylesheets", "javascripts", "liquid", "html", "pdf"],
  "liquid" : {
    "includes" : "includes"
  },
  "images" : {
    "source" : "images",
    "destination" : "assets"
  },
  "stylesheets" : {
    "destination" : "assets"
  },
  "javascripts" : {
    "destination" : "assets"
  }
}

function getMarkdownConverter() {

  var md = new MarkdownIt({

    html: true,

    // make sure that we add htmlbook to code examples
    highlight: function (str, lang) {
      var langClass = _.isEmpty(lang) ? '' : ' data-code-language="'+lang+'"';
      return '<pre data-type="programlisting"'+langClass+'><code>' + md.utils.escapeHtml(str) + '</code></pre>';
    }

  });

  return md;
}

// Pipes
// --------------------------------------------

// through2 function to convert a markdown file to html
// Returns: Vinyl filestream
function markdown(md) {
  return through.obj(function (file, enc, cb) {
    if(fileHelpers.isMarkdown(file)) {

      // convert md to HTML
      var fileHTML = md.render(file.contents.toString());

      // make HTMLBook sections from headings
      var sectionHTML = htmlbookHelpers.makeHtmlBook(fileHTML);

      // put that back into the file
      file.contents = new Buffer(sectionHTML);
      file.path = gutil.replaceExtension(file.path, '.html');

    }
    cb(null, file);
	});
}

// Duplicates a stream. Used when the format chains diverge.
// Returns: Duplicated file stream
function duplicate() {
  return through.obj(function(file, enc, cb) {
    cb(null, file.clone());
  });
}

// Assigns layouts to the files in the stream.
// Prioritizes format layout over main layout.
function layouts(config, extraLocals) {

  return through.obj(function(file, enc, cb) {

    var layout = _.get(file, "config.layout") || config.layout;

    if(layout) {

      // create the object to pass into liquid for this file
      var locals = {
        content: file.contents.toString(),
        format: config.format,
        config: config,
        page: file.config
      }

      if(extraLocals) {
        _.assign(locals, extraLocals);
      }

      if(layoutCache[layout]) {
        helpers.renderLiquidTemplate(layoutCache[layout], locals, file, config, cb);
      } else {
        fs.readFile(layout, function (err, data) {
          if (err) { return console.log(err); }
          layoutCache[layout] = tinyliquid.compile(data.toString());
          helpers.renderLiquidTemplate(layoutCache[layout], locals, file, config, cb);
        });
      }
    } else {
      cb(null, file);
    }
  });
}

// Main
// --------------------------------------------

module.exports = function(jsonConfig) {

  // if there is no builds array or it's empty,
  // return an error message
  if(!_.isArray(jsonConfig.builds) || _.isEmpty(jsonConfig.builds)) {
    return console.log("No build settings detected. Please add a builds array to your config");
  }

  // run build for each format
  _.each(jsonConfig.builds, function(build, i) {

    // if there is no format in the build object
    if(!build.format) return console.log("no format in build setting. Skipping build " + (i+1))

    // make a config object that consists of the build config,
    // with the main config and defaults merged on top of it.
    // We remove the "builds" property and add the build number.
    var config = {};
    // _.defaults(config, jsonConfig, defaults);
    _.merge(config, defaults, jsonConfig, build);
    config.buildNumber = i + 1;
    delete config.builds;

    // if there are addPlugins, add it to end of plugins.
    if(config.addPlugins) {
      config.plugins = config.plugins.concat(config.addPlugins);
    }

    // if there are removePlugins, remove them from plugins.
    if(config.removePlugins) {
      config.plugins = _.difference(config.plugins, config.removePlugins);
    }

    // figure out the build folder for this format
    var destination = helpers.destination(config.destination, config.buildNumber);

    // we create a converter for each format, as each format
    // can have different markdown settings.
    var md = getMarkdownConverter();

    // require and instantiate plugins for this format
    pluginsCache = fileHelpers.requireFiles(pluginsCache, config.plugins, "plugins", config.verbose)
    var plugins = pluginHelpers.instantiatePlugins(pluginsCache, config.plugins);

    // hook: setup
    pluginHelpers.callHook('setup', plugins, [config, { md: md, locals:{}, destination: destination }], function(config, extras) {

      // create our stream
      var stream = vfs.src(config.files);

      // hook: load
      pluginHelpers.callHook('load', plugins, [config, stream, extras], function(config, stream, extras) {

        stream = stream.pipe(markdown(md));

        pluginHelpers.callHook('convert', plugins, [config, stream, extras], function(config, stream, extras) {

          stream = stream.pipe(layouts(config, extras.locals));

          pluginHelpers.callHook('layout', plugins, [config, stream, extras], function(config, stream, extras) {

            pluginHelpers.callHook('finish', plugins, [config, stream, extras], function(config, stream, extras) {

              if(config.verbose) console.log('Build', config.buildNumber, 'finished');
              if(config.finish) {
                config.finish(config.format, null);
              }

            });
          });
        });
      });
    });
  });
}

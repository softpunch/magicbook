var through = require('through2');
var htmlbookHelpers = require('../helpers/htmlbook');

var Plugin = function(){};

Plugin.prototype = {

  hooks: {

    layout: function(config, stream, extras, cb) {

      var nav = {};

      // first create hashmap of files and their sections
      stream = stream.pipe(through.obj(function(file, enc, cb) {

        // create cheerio element for file
        if(!file.$el) {
          var content = file.contents.toString();
          file.$el = cheerio.load(content);
        }


        // create navigation
        nav[file.path] = htmlbookHelpers.navigationize(file.$el);
        console.log(nav[file.path]);

        cb(null, file);
      }));

      cb(null, config, stream, extras);
    }
  }
}

module.exports = Plugin;
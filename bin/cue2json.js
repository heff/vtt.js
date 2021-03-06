#!/usr/bin/env node
var opt = require("optimist")
    .usage("Parse VTT files into JSON.\n" +
           "Usage: $0 [options]")
    .demand("v")
    .options("v", {
      alias: "vtt",
      describe: "Path to a VTT file or directory that contains VTT files to be processed."
    })
    .options("c", {
      alias: "copy",
      describe: "Copies output to a JSON file with the same name as the source VTT file."
    })
    .options("p", {
      alias: "process",
      describe: "Generate JSON from running the WebVTT processing model. Default is JSON from the WebVTT parser."
    })
    .options("n", {
      alias: "new",
      describe: "Creates a new JSON file for any VTT file that does not have one. Works recursively in a directory."
    }),
  argv = opt.argv,
  path = require("path"),
  fs = require("fs"),
  NodeVTT = require("../lib/node-vtt.js"),
  exec = require("child_process").exec,
  dive = require("dive");

function fail(message, fatal) {
  message = message || "Unable to process request.";
  console.error("Error: " + message);
  if (fatal) {
    process.exit(1);
  }
  return false;
}

// Create an instance of NodeVTT which interfaces with vtt.js and PhantomJS for us.
function createNodeVTT(onCreated) {
  var parser = new NodeVTT();
  parser.init(function(error) {
    if (error) {
      parser.shutdown();
      fail("Unable to initialize an instance of NodeVTT. " + error.message,
           true);
    }
    onCreated(parser);
  });
}

// Write JSON either to standard out or to a file.
function writeOutput(data, path) {
  var json;
  try {
    json = JSON.stringify(data, null, 2);
  } catch(error) {
    return fail("Unable to jsonify data. " + error.message);
  }
  if (path) {
    console.log("Writing " + path);
    try {
      fs.writeFileSync(path, json + "\n");
      return true;
    } catch (e) {
      return fail("Unable to write output. " + e.message);
    }
  }
  console.log(json);
  return true;
}

// Get the file name of the file we should save the JSON to.
function getJSONFileName(path) {
  if (argv.c) {
    return path.replace(/\.vtt$/, ".json")
  }
}

// Will either just parse a VTT file or will run the processing model as well
// based on what command line arguments have been passed.
function doParserAction(parser, path, onCompleted) {
  if (argv.p) {
    return parser.processFile(path, onCompleted);
  }
  parser.parseFile(path, function(error) {
    if (error) {
      return onCompleted(error);
    }
    parser.flush(function() {
      return onCompleted(null, parser.vtt);
    });
  });
}

// Process a single VTT file and output it's JSON.
function processSingleFile(path) {
  createNodeVTT(function(parser) {
    doParserAction(parser, path, function(error, data) {
      if (error) {
        parser.shutdown();
        fail(error.message, true);
      }
      writeOutput(data, getJSONFileName(path));
      parser.shutdown();
    });
  });
}

// Walk through a directory tree and process any number of VTT files into JSON.
// Which VTT files and where the output of the JSON goes is determined by the
// arguments passed to the script.
function recurse(path) {
  createNodeVTT(function(parser) {
    var files = [];
    function onFile(error, file) {
      if (file.match(/\.json$/)) {
        path = file.replace(/\.json$/, ".vtt");
        if (fs.existsSync(path)) {
          files.push(path);
        }
      } else if (file.match(/\.vtt$/) && argv.n) {
        files.push(file);
      }
    }

    function onCompleted() {
      var count = total = files.length;
      function iterate() {
        if (files.length === 0) {
          console.log("Files Written: " + count + ", Failed: " +
                      (total - count) + ".");
          return parser.shutdown();
        }
        var file = files.pop();
        doParserAction(parser, file, function(error, data) {
          if (error) {
            count--;
            return fail("Couldn't write " + file + ". " + error.message);
          }
          writeOutput(data, getJSONFileName(file));
          parser.clear(iterate);
        });
      }
      iterate();
    }

    dive(path, onFile, onCompleted);
  });
}

if (!fs.existsSync("./dist/vtt.min.js")) {
  fail("Error: You must first build vtt.js by running `grunt build`", true);
}
var path = argv.v;
try {
  var stats = fs.lstatSync(path);
  if (stats.isDirectory()) {
    argv.c = true; // Default when walking dirs is to write to copy.
    return recurse(path);
  }
  if(!path.match(/\.vtt$/)) {
    fail("Error: File must be a VTT file.", true);
  }
  processSingleFile(path);
} catch(error) {
  fail(error.message, true);
}

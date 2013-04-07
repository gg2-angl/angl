var jade = require('jade');
var stylus = require('stylus');
var _ = require('lodash');
var child_process = require('child_process');
require('shelljs/global');

var input, output;

// create output directories
mkdir('-p', 'out/demo/vendor');

// render demo html
input = cat('demo/index.jade');
output = jade.compile(input)();
output.to('out/demo/index.html');

// render demo css
input = cat('demo/style.styl');
stylus(input).render(function(err, output) {
    if(err) throw err;
    output.to('out/demo/style.css');

    // Compile TypeScript
    var cmd = require.resolve('typescript/' + require('typescript/package.json').bin.tsc);
    child_process.spawn(process.argv[0], [cmd, '--sourcemap', 'lib/angl-scope.ts'], {stdio: ['ignore', 1, 2]}).on('close', function(code) {
        if(code) throw code;

        // Build a minified JS bundle
        require('./run-requirejs-optimizer');
    });
});

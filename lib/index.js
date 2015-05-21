var
	Parser = require('./parser.js'),
	fs = require('fs');

var p = new Parser({
	onopentag: function(name, attributes, selfClosed) {
		/*process.stdout.write('<' + name);
		
		for(var attr in attributes) {
			process.stdout.write(' ' + attr + '=\"' + attributes[attr] + '\"');
		}
		
		process.stdout.write((selfClosed ? ' /' : '') + '>');*/
	},
	onclosetag: function(name, selfClosed) {
		/*if(!selfClosed) {
			process.stdout.write('</' + name + '>');
		}*/
	},
	ontext: function(text) {
		//process.stdout.write(text);
	},
	onprocessinginstruction: function(name, text) {
		//console.log(text);
	}
}, {
	recognizeSelfClosing: true
});

var buffer = fs.readFileSync('../test/test2.html');

var startTime = process.hrtime();

p.write(buffer);
p.end();

/*p.fromFile('../test/test2.html', {
	disableBuffer: true,
	//bufferSize: 10
});*/

var endTime = process.hrtime(startTime);
console.log('\n\nbenchmark took %d milliseconds', (endTime[0] * 1e9 + endTime[1]) * 1e-6);

module.exports = {
	Parser: Parser
};
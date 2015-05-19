var
	Parser = require('./parser.js');

var p = new Parser({
	onopentag: function(name, attributes, selfClosed) {
		process.stdout.write('<' + name);
		
		for(var attr in attributes) {
			process.stdout.write(' ' + attr + '=\"' + attributes[attr] + '\"');
		}
		
		process.stdout.write((selfClosed ? ' /' : '') + '>');
	},
	onclosetag: function(name, selfClosed) {
		if(!selfClosed) {
			process.stdout.write('</' + name + '>');
		}
	},
	ontext: function(text) {
		process.stdout.write(text.trim());
	}
}, {
	recognizeSelfClosing: true
});
var startTime = process.hrtime();

p.fromFile('../test/test.html', {
	disableBuffer: true,
	//bufferSize: 10
});

var endTime = process.hrtime(startTime);
console.log('\n\nbenchmark took %d milliseconds', (endTime[0] * 1e9 + endTime[1]) * 1e-6);

module.exports = {
	Parser: Parser
};
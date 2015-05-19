var
	fs = require('fs'),
	path = require('path'),
	StringDecoder = require('string_decoder').StringDecoder;

// Constants
var _DEFAULT_READ_BUFFER_SIZE = 1024;

// Enums
var EnumParserCharacterCodes = {
	HtmlTagOpen:		0x3c,
	HtmlTagClose:		0x3e,
	HtmlElementClose:	0x2f,
	HtmlSelfClose:		0x2f,
	HtmlSpace:			0x20,
	HtmlEqualSign:		0x3d
};

var EnumParserState = (function() {
	var i = 0;
	return {
		Text: 			i++,
		ElementOpen:	i++,
		ElementClose:	i++,
		_max: i
	};
})();

// Error objects
function HtmlError(_message, _filename, _line, _column) {
	this.message = _message;
	this.filename = _filename;
	this.line = _line;
	this.column = _column;
}

HtmlError.prototype.toString = function() {
	return 'Syntax Error: ' + (this._filename ? this._filename + ': ' : '') + 'Line ' + this._line + ', Column ' + this._column + '\n\t' + this._message;
};

function GenericError(msg) {
	throw ("Error: " + msg);
}

/* Options
	{
		encoding: 'utf8',				// A string containing the type of encoding to use for converting the input buffer to text for callbacks
		filename: undefined,			// Sets the filename to use for syntax errors when self loading a file or performing inline HTML validation
		disableBuffer: false,			// When set to false, multiple calls to the ontext callback will be made when text data overflows the current buffer. (Saves memory)
		xmlMode: false,					// Treat all tags and text the same with no special rules applied (i.e. JavaScript and CSS)
		recognizeSelfClosing: false,	// Call the 'onclosetag' callback on tags that are self closing (true if xmlMode = true)
	}
	
   Callbacks
	{
		onerror: function(error) { },							// Returns an error object with details
		onopentag: function(name, attributes, selfClosed) { },	// Called after parsing an opening element tag. 'selfClosed' is a boolean set to true when tag is also self closed (e.g <img />)
		onclosetag: function(name, selfClosed) { },				// A closing HTML tag encountered. 'selfClosed' is the same for onopentag, except this is only true in XHTML mode.
	}
*/
var Parser = function(callbacks, options) {
	this._callbacks = callbacks || { };
	this._options = options || { };
	
	if(this._options.xmlMode) {
		this._options.recognizeSelfClosing = true;
	}
	
	var encoding = this._options.encoding || 'utf8';
	if(!Buffer.isEncoding(encoding)) {
		GenericError('The encoding specified \'' + encoding  + '\' is not valid');
	}
	
	this._decoder = new StringDecoder(encoding);
	
	this._reset();
};

Parser.prototype._reset = function() {
	this._line = 1;
	this._column = 1;
	this._errors = [];
	this._filename = this._options.filename;
	this._start = 0;
	this._state = EnumParserState.Text;
};

Parser.prototype._syntaxError = function(msg, fatal) {
	var instance = this;
	(this._callbacks.onerror || function(error) {
		if(fatal) {
			throw error;
		}
		else {
			instance._errors.push(error);
		}
	})(new HtmlError(msg, this._filename, this._line, this._column));
};


// Parsing element tags is quite a process, these next few functions will be the helpers for getting things sorted out.
Parser.prototype._beginElementTag = function(buffer) {
	this._htmlElementFull = buffer;
	this._htmlTag = undefined;
	this._htmlAttributes = [];
	this._tagStart = 0;
	this._currentAttribute = undefined;
	this._tagDone = false;
	this._attributeDone = true;
};

Parser.prototype._endElementTag = function() {
	this._htmlElementFull = undefined;
	this._htmlTag = undefined;
	this._htmlAttributes = undefined;
	this._tagStart = undefined;
	this._currentAttribute = undefined;
	this._tagDone = undefined;
	this._attributeDone = undefined;
};

Parser.prototype._processElementTag = function(o) { // Parameter is the current index in
	if(!this._htmlTag) {
		this._htmlTag = this._decoder.write(this._htmlElementFull.slice(this._tagStart, o));
	}
	else if(this._currentAttribute) {
		var attrText = this._decoder.write(this._htmlElementFull.slice(this._tagStart, o));
		
		if(this._attributeDone) {
			var trimStart = 0;
			if((trimStart = attrText.indexOf('\"')) == 0) {
				var trimEnd = 0;
				if((trimEnd = attrText.lastIndexOf('\"')) + 1 == attrText.length) {
					attrText = attrText.substring(trimStart + 1, trimEnd);
				}
				else { 
					attrText = attrText.substring(trimStart + 1);
					this._attributeDone = false;
				}
			}
		}
		else {
			var trimEnd = attrText.lastIndexOf('\"');
			if(trimEnd == attrText.length - 1) {
				attrText = attrText.substring(0, trimEnd);
				this._attributeDone = true;
			}
		}
		
		if(this._htmlAttributes[this._currentAttribute]) {
			this._htmlAttributes[this._currentAttribute] += ' ' + attrText;
		}
		else {
			this._htmlAttributes[this._currentAttribute] = attrText;
		}
		
		if(this._attributeDone) {
			this._currentAttribute = undefined;
		}
		
	} // else error here
	
	this._tagStart = o + 1;
	
	if(this._tagDone) {
		return this._htmlElementFull.length; // Leave the loop, nicely
	}
	
	return o;
};

Parser.prototype.write = function(buffer) {
	for(var i = 0; i < buffer.length; i++) {
		switch(buffer[i]) {
			case EnumParserCharacterCodes.HtmlTagOpen:
				if(this._state != EnumParserState.Text) {
					throw 'Unexpected \'<\' token';
				}
				
				if(i > this._start) {
					this._callbacks.ontext(this._decoder.write(buffer.slice(this._start + 1, i)));
				}
				
				this._state = EnumParserState.ElementOpen;
				this._start = i + 1;
				break;
			case EnumParserCharacterCodes.HtmlElementClose:
				if(this._start == i && this._state == EnumParserState.ElementOpen) {
					this._state = EnumParserState.ElementClose;
					this._start = i + 1;
				}
				break;
			case EnumParserCharacterCodes.HtmlTagClose:
				if(this._state == EnumParserState.ElementOpen) {
					// Parse the HTML element tag
					this._beginElementTag(buffer.slice(this._start, i));
					
					var o = 0;
					for(; o < this._htmlElementFull.length; o++) {
						switch(this._htmlElementFull[o]) {
							case EnumParserCharacterCodes.HtmlSelfClose:
								if(this._htmlTag && this._attributeDone) {
									if(o == this._htmlElementFull.length - 1) {
										this._tagDone = true;
									}
									else {
										break;
									}
								}
							case EnumParserCharacterCodes.HtmlEqualSign:
								if(this._htmlTag && this._attributeDone) {
									this._currentAttribute = this._decoder.write(this._htmlElementFull.slice(this._tagStart, o));
									this._tagStart = o + 1;
									break;
								}
							case EnumParserCharacterCodes.HtmlSpace: // TODO: Check any whitespace here
								o = this._processElementTag(o);
								break;
						}
					}
					o = this._processElementTag(o);
					
					this._callbacks.onopentag(this._htmlTag, this._htmlAttributes, this._tagDone);
					
					if(this._tagDone && this._options.recognizeSelfClosing) {
						this._callbacks.onclosetag(this._htmlTag, this._tagDone);
					}
					
					this._state = EnumParserState.Text;
					this._start = i;
					
					this._endElementTag();
				}
				if(this._state == EnumParserState.ElementClose) {
					this._callbacks.onclosetag(this._decoder.write(buffer.slice(this._start, i)), false);
					this._state = EnumParserState.Text;
					this._start = i;
				}
				break;
		}
	}
};

Parser.prototype.parseChunk = Parser.prototype.write;

Parser.prototype.end = function() { // TODO
	
};
Parser.prototype.done = Parser.prototype.end;

Parser.prototype.reset = function() { // TODO
	
};

Parser.prototype.parseComplete = function() { // TODO
	
};

// Reads from a file
/* Options:
	{
		disableBuffer: false,	// Boolean indicating to use a buffered method of reading or load entire file at once.
		bufferSize: 1024		// Buffer size to use in bytes. The default is 1 KB
	}
*/
Parser.prototype.fromFile = function(filepath, options) {
	var readOptions = options || { };
	var bufferSize = readOptions.bufferSize || _DEFAULT_READ_BUFFER_SIZE;
	
	var file = undefined;
	try {
		this._filename = path.basename(filepath);
		if(readOptions.disableBuffer) {
			// Read the entire file. This is quicker, but causes problems when RAM is limited (obviously).
			// Hence why it's not the prefered method here.
			this.write(fs.readFileSync(filepath));
		}
		else {
			file = fs.openSync(filepath, 'r');
			var bytes = 0;
			var buffer = new Buffer(bufferSize);
			while((bytes = fs.readSync(file, buffer, 0, buffer.length, null)) > 0) {
				this.write(buffer); // Only parse what we have, not the entire buffer.
			}
		}
	}
	catch(e) {
		throw e;
	}
	finally {
		if(file) {
			fs.close(file);
		}
	}
};

// Exports
module.exports = Parser;
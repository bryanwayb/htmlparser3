var
	fs = require('fs'),
	path = require('path');

// Constants
var _DEFAULT_READ_BUFFER_SIZE = 1024;

// Enums
var EnumParserCharacterCodes = {
	HtmlTagOpen:		0x3c,
	HtmlTagClose:		0x3e,
	HtmlElementClose:	0x2f,
	HtmlSelfClose:		0x2f,
	HtmlSpace:			0x20,
	HtmlTab:			0x09,
	HtmlEqualSign:		0x3d,
	HtmlDoubleQuotes:	0x22
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
function HtmlError(_message, _filename, _line, _column, _fatal) {
	this.message = _message;
	this.filename = _filename;
	this.line = _line;
	this.column = _column;
	this.fatal = _fatal;
}

HtmlError.prototype.toString = function() {
	return (this.fatal ? 'Fatal ' : '') + 'Syntax Error: ' + (this.filename ? this.filename + ': ' : '') + 'Line ' + this.line + ', Column ' + this.column + '\n\t' + this.message;
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
	this._parseElement = this._callbacks.onopentag || this._callbacks.onclosetag; // Parsing an element takes up a considerable amount of time. Only do this when needed by a callback.
	
	this._options = options || { };
	
	if(this._options.xmlMode) {
		this._options.recognizeSelfClosing = true;
	}
	
	this._encoding = this._options.encoding || 'utf8';
	if(!Buffer.isEncoding(this._encoding)) {
		GenericError('The encoding specified \'' + this._encoding  + '\' is not valid');
	}
	
	this._reset();
};

Parser.prototype._reset = function() { // Internal reset, doesn't call provided callback
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
	})(new HtmlError(msg, this._filename, this._line, this._column, fatal));
};

Parser.prototype.write = function(buffer) {
	for(var i = 0; i < buffer.length; i++) {
		switch(buffer[i]) {
			case EnumParserCharacterCodes.HtmlTagOpen:
				if(this._state != EnumParserState.Text) {
					this._syntaxError('Unexpected \'<\' token', true);
					return;
				}
				
				if(this._callbacks.ontext && i > this._start) {
					this._callbacks.ontext(buffer.toString(this._encoding, this._start + 1, i));
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
					if(this._parseElement) {
						var htmlTag = undefined;
						var currentAttribute = undefined;
						var attributeQuoted = false;
						var attributes = [];
						var tagSelfClosed = false;

						var o = this._start;
						for(; o <= i; o++) {
							switch(buffer[o]) {
								case EnumParserCharacterCodes.HtmlSelfClose:
									if(htmlTag && !currentAttribute) {
										tagSelfClosed = true;
										o = i; // Leave the loop, nicely. This means that processing of a tag can be stopped halfway
									}
									break;
								case EnumParserCharacterCodes.HtmlTagClose:
									if(o != i) { // Only do final processing if at the end of the tag
										break;
									}
								case EnumParserCharacterCodes.HtmlTab:
								case EnumParserCharacterCodes.HtmlSpace:
									//
									if(!htmlTag) {
										htmlTag = buffer.toString(this._encoding, this._start, o);
										this._start = o + 1;
									}
									else if(!attributeQuoted) {
										if(currentAttribute) {
											attributes[currentAttribute] = buffer.toString(this._encoding, this._start, o);
											currentAttribute = undefined;
											this._start = o + 1;
										}
										else {
											currentAttribute = buffer.toString(this._encoding, this._start, o).trim();
											if(currentAttribute.length > 0) {
												// TODO: HTML valid, but maybe make options for boolean values and attribute-as-value as well (test=true or test=test instead of just test="")?
												attributes[currentAttribute] = '';
												this._start = o + 1;
											}
											currentAttribute = undefined;
										}
									}
									//
									break;
								case EnumParserCharacterCodes.HtmlEqualSign:
									if(htmlTag) {
										if(!currentAttribute) {
											currentAttribute = buffer.toString(this._encoding, this._start, o).trim();
											this._start = o + 1;
										}
									}
									else {
										this._syntaxError('Attribute assign token found in tag name');
									}
									break;
								case EnumParserCharacterCodes.HtmlDoubleQuotes:
									if(currentAttribute) {
										if(this._start == o) {
											attributeQuoted = true;
											this._start = o + 1;
										}
										else if(attributeQuoted) {
											attributes[currentAttribute] = buffer.toString(this._encoding, this._start, o);
											currentAttribute = undefined;
											attributeQuoted = false;
											this._start = o + 1;
										}
										else {
											this._syntaxError('Double-quote found inside attribute', false);
										}
									}
									break;
							}
						}
						
						if(!htmlTag) {
							this._syntaxError('No tag name specified', false);
						}
						else {
							if(currentAttribute) {
								this._syntaxError('Unexpected tag termination, expected attribute value', false);
							}
							else if(attributeQuoted) {
								this._syntaxError('Unexpected tag termination, quoted attribute value unclosed', false);
							}
							
							if(this._callbacks.onopentag) {
								this._callbacks.onopentag(htmlTag, attributes, tagSelfClosed);
							}
						}
					}
					
					this._state = EnumParserState.Text;
					this._start = i;
				}
				if(this._state == EnumParserState.ElementClose) {
					if(this._callbacks.onclosetag) {
						this._callbacks.onclosetag(buffer.toString(this._encoding, this._start, i), false);
					}
					this._state = EnumParserState.Text;
					this._start = i;
				}
				break;
		}
	}
};

Parser.prototype.parseChunk = Parser.prototype.write;

Parser.prototype.end = function() { // There's not an actual reason to have this function aside from compatibilty from moving from another htmlparser library.
	if(this._options.onend) {
		this._options.onend();
	}
};
Parser.prototype.done = Parser.prototype.end; // Ditto

Parser.prototype.reset = function() {
	if(this._options.onreset) {
		this._options.onreset();
	}
	
	this._reset();
};

Parser.prototype.parseComplete = function() {
	this.reset();
	this.end();
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
				this.write(buffer.slice(0, bytes)); // Only parse what we have, not the entire buffer.
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
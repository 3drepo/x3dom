/*
 * X3DOM JavaScript Library
 * http://www.x3dom.org
 *
 * (C)2016 3DRepo London
 * Licensed under the MIT
 *
 * Author: Sebastian Friston
 */

//GraphicsMemoryManager handles memory in blocks. A block is represented by an object, a reference to which is held by
//GraphicsMemoryManager and the object which owns the block. The members of this block are used to communicate between
//GraphicsMemoryManger and the owner.

x3dom.GraphicsMemoryBlock = function()
{

};

x3dom.GraphicsMemoryBlock.prototype.write = function(array, offset)
{
	var that = this;
	
    that._manager.gl.bindBuffer(that._buffer.gltarget, that._buffer.glbuffer);
    that._manager.gl.bufferSubData(that._buffer.gltarget, that.glBufferOffset + offset, array)
};

// Signals the content has changed. Resizes the block if necessary but always marks it as dirty.
x3dom.GraphicsMemoryBlock.prototype.resize = function(newsize)
{
    this._size = newsize;
};


//GraphicsMemoryManager is responsible for the allocation and book-keeping of large dynamic arrays
//for attribute and index data for multipart meshes.
x3dom.GraphicsMemoryManager = function(){

};

x3dom.GraphicsMemoryManager.getGraphicsMemoryManager = function(gl)
{
    if(!gl._graphicsMemoryManager){

        var newGraphicsMemoryManager = new x3dom.GraphicsMemoryManager();
        newGraphicsMemoryManager.gl = gl;
        newGraphicsMemoryManager.buffers = {};

        gl._graphicsMemoryManager = newGraphicsMemoryManager;
    }
    return gl._graphicsMemoryManager;
};

x3dom.GraphicsMemoryManager.prototype.getBlock = function(target, owner)
{
    var that = this;
    var newBlock = new x3dom.GraphicsMemoryBlock();

    if(!that.buffers[target]) {
        that.buffers[target] = {
            blocks : [],
            glbuffersize : -1,
            gltarget : target
        };
    }
    that.buffers[target].blocks.push(newBlock);

    //initialise new block
    newBlock._manager = that;
    newBlock._target = target;
    newBlock._owner = owner;
    newBlock._buffer = that.buffers[target];

    newBlock._size = 0;

    newBlock.glBuffer = 0;
    newBlock.glBufferOffset = 0;
    newBlock.valid = false;

    return newBlock;
};

x3dom.GraphicsMemoryManager.prototype.rebuild = function()
{
    var that = this;
    var gl = that.gl;

    for(var bufferid in that.buffers)
    {
        var buffer = that.buffers[bufferid];
        var totalBytes = 0;

        for(var i = 0; i < buffer.blocks.length; i++)
        {
            var block = buffer.blocks[i];
            block.glBufferOffset = totalBytes;
            totalBytes += block._size;
        }

        if(totalBytes > buffer.glbuffersize) {
            //need a new buffer
				
			var oldBuffer = buffer.glbuffer;
            buffer.glbuffer = gl.createBuffer();
            gl.bindBuffer(buffer.gltarget, buffer.glbuffer);
            gl.bufferData(buffer.gltarget, totalBytes, gl.DYNAMIC_DRAW);
			
			gl.deleteBuffer(oldBuffer);
			
            buffer.glbuffersize = totalBytes;

            for(var i = 0; i < buffer.blocks.length; i++)
            {
                buffer.blocks[i].glBuffer = buffer.glbuffer;
            }
        }

        for(var i = 0; i < buffer.blocks.length; i++)
        {
            buffer.blocks[i]._owner.writeGPUBlock(buffer.blocks[i]);
        }
    }
};
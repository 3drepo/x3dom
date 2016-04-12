/** @namespace x3dom.nodeTypes */
/*
 * X3DOM JavaScript Library
 * http://www.x3dom.org
 *
 * (C)2016 3DRepo London
 * Licensed under the MIT
 *
 * Author: Sebastian Friston (based on ExternalGeometry.js)
 */

var msPerFrame = 100000.0;

var tickStart = null;
var returned = true;

var primitiveCount = 0;

var maxIndex = 0;

var memory = {
	submeshes : {}
};

var visibilityMap = {};
var removeQueue = [];
var addQueue    = [];

/*
function resultReceiver(event) {
	results.push(parseInt(event.data));
	if (results.length == 2) {
		postMessage(results[0] + results[1]);
	}
}
*/

// This function takes a block 
function compact(blockID)
{
	
}

onmessage = function(event) {
	"use strict";
	
	// For a register bufferView event, transfer the
	// memory to be held here. Along with a description
	// of how the sub-meshes constitute it. 
	
	var i;
	
	if (event.data.type === "registerMe")
	{
		memory.data = event.data;
		
		// Create buffers spaces that are ready to upload to the GPU
		memory.constructedBuffers = {};
		
		for (i = 0; i < event.data.bufferViews.length; i++)
		{
			var key = event.data.bufferViews[i].key;
			memory.constructedBuffers[key] = new ArrayBuffer();
		}
		
		// Build up a map from the ID of the submesh to 
		// information about it's segmentation
		for(i = 0; i < event.data.submeshes.length; i++)
		{
			var submesh = event.data.submeshes[i];
			
			memory.submeshes[submesh.primitive.extras.refID] = submesh;
			memory.submeshes[submesh.primitive.extras.refID].constructedBufferOffsets = {};
			memory.submeshes[submesh.primitive.extras.refID].startIndex = -1;
			memory.submeshes[submesh.primitive.extras.refID].endIndex = -1;
			
			// Add everything to queue to be displayed as quickly as possible.
			addQueue.push(submesh.primitive.extras.refID);
			
			// Everything starts off invisible
			visibilityMap[submesh.primitive.extras.refID] = false;
		}
		
		msPerFrame = 1000.0 / event.data.ops;
		
	} else if (event.data.type === "changeVisibility") {
		// Pass in a list of IDs that need to be switched off
		// and switch on. Create a queue here to work through
		// based on a sorting mechanism.
		
		var subMeshID;
		
		for (subMeshID in memory.submeshes)
		{
			if (memory.submeshes.hasOwnProperty(subMeshID))
			{
				var visible = (event.data.ids.indexOf(subMeshID) > -1);
				
				if (visible)
				{
					var removeQueueIDX = removeQueue.indexOf(subMeshID);
					
					if (removeQueueIDX > -1)
					{
						removeQueue.splice(removeQueueIDX, 1);
					}
					
					if (!visibilityMap[subMeshID])
					{
						if (addQueue.indexOf(subMeshID) === -1)
						{
							addQueue.push(subMeshID);
						}
					}
				} else {
					var addQueueIDX = addQueue.indexOf(subMeshID);
					
					if (addQueueIDX > -1)
					{
						addQueue.splice(addQueueIDX, 1);
					}
					
					if (visibilityMap[subMeshID])
					{
						if (removeQueue.indexOf(subMeshID) === -1)
						{
							removeQueue.push(subMeshID);
						}
					}
				}
			}
		}
		
	} else if (event.data.type === "returnBuffers") {
		for (i = 0; i < event.data.keys.length; i++)
		{
			var key = event.data.keys[i];
			memory.constructedBuffers[key] = event.data.buffers[i];
		}
		
		returned = true;
	}
	
	
};

function _returnBuffers() {
	"use strict";
	
	if (!tickStart)
	{
		tickStart = new Date().getTime();
	} else {				
		var elapsedTime = (new Date().getTime()) - tickStart;
		
		if ((elapsedTime > msPerFrame) || !addQueue.length)
		{
			var returnBuffers = [];
			
			for (var k in memory.constructedBuffers)
			{
				if (memory.constructedBuffers.hasOwnProperty(k))
				{
					returnBuffers.push(memory.constructedBuffers[k]);
				}
			}

			postMessage(
				{
					type: "bufferReady",
					keys: Object.keys(memory.constructedBuffers),
					buffers: returnBuffers,
					count: primitiveCount
				},
			returnBuffers);
			
			returned = false;
			tickStart = null;
		} 
	}
}

function processQueue() {
	"use strict";
	
	var profileStart = null;
	
	if (returned)
	{
		// First deal with removing objects from buffer
		while(returned && removeQueue.length)
		{
			_returnBuffers();

			var first = removeQueue.shift();
			var submesh = memory.submeshes[first];
			var segmentNames = Object.keys(memory.constructedBuffers);
			
			var indexBuffer;
			
			// Now visible
			visibilityMap[first] = false;
			
			// Cut submesh out of buffer
			for (var i = 0; i < segmentNames.length; i++)
			{
				var segmentName = segmentNames[i];
				var segmentLength, segmentStart, segmentEnd;
				
				indexBuffer = !submesh.segments.hasOwnProperty(segmentName);
				
				if (!indexBuffer)
				{	
					segmentLength = submesh.segments[segmentName].lengthBytes;	
				} else {
					segmentLength = submesh.indices.lengthBytes;
				}	
							
				segmentStart = submesh.constructedBufferOffsets[segmentName];
				segmentEnd   = segmentStart + segmentLength;

				var oldBuffer       = memory.constructedBuffers[segmentName];
				var oldLength       = oldBuffer.byteLength;
				var oldBufferObject = new Uint8Array(oldBuffer, 0, oldLength);
				
				var newLength       = oldLength - segmentLength;
				var newBuffer       = new ArrayBuffer(newLength);
				var newBufferObject = new Uint8Array(newBuffer, 0, newLength);
				
				var preBuffer       = oldBufferObject.slice(0, segmentStart);
				var postBuffer      = oldBufferObject.slice(segmentEnd);	
				
				// Must re-index everything
				if (indexBuffer)
				{
					var indexDelta = (submesh.endIndex - submesh.startIndex) + 1;
					maxIndex = maxIndex - indexDelta;
					
					var indexData = new Uint16Array(postBuffer.buffer);
					
					for (var j = 0; j < indexData.length; j++)
					{
						var newIndex = indexData[j] - indexDelta;
						indexData[j] = newIndex;
					}
					
					submesh.startIndex = -1;
					submesh.endIndex   = -1;
					
					primitiveCount -= submesh.indices.count;
				}
				
				// Adjust other submesh offsets
				for (var subMeshID in memory.submeshes)
				{
					var otherSubMesh = memory.submeshes[subMeshID];
				
					if ('undefined' !== typeof otherSubMesh.constructedBufferOffsets[segmentName])
					{
						if(otherSubMesh.constructedBufferOffsets[segmentName] > segmentStart) 
						{
							otherSubMesh.constructedBufferOffsets[segmentName] -= segmentLength;
						}
					}
				}
				
				newBufferObject.set(preBuffer, 0);
				newBufferObject.set(postBuffer, segmentStart);
				
				submesh.constructedBufferOffsets[segmentName] = -1;
				memory.constructedBuffers[segmentName] = newBuffer;			
			}
			
			_returnBuffers();
		}
		
		// Next, deal with adding object to buffer
		while(returned && addQueue.length)
		{
			_returnBuffers();
					
			var first = addQueue.shift();
			var submesh = memory.submeshes[first];
			var segmentNames = Object.keys(memory.constructedBuffers);
			
			var indexBuffer;
			
			// Now visible
			visibilityMap[first] = true;
			
			for (var i = 0; i < segmentNames.length; i++)
			{
				var segmentName = segmentNames[i];
				
				var segmentLength, segmentStart, segmentEnd;
				
				indexBuffer = !submesh.segments.hasOwnProperty(segmentName);
				
				if (!indexBuffer)
				{			
					segmentLength = submesh.segments[segmentName].lengthBytes;
					segmentStart  = submesh.segments[segmentName].startBytes;
					segmentEnd    = submesh.segments[segmentName].endBytes;
				} else {
					segmentLength = submesh.indices.lengthBytes;
					segmentStart  = submesh.indices.startBytes;
					segmentEnd    = submesh.indices.endBytes;	
					
					primitiveCount += submesh.indices.count;
				}
				
				
				var oldLength       = memory.constructedBuffers[segmentName].byteLength;
				var oldBuffer       = memory.constructedBuffers[segmentName];
				var oldBufferObject = new Uint8Array(oldBuffer, 0, oldLength);
				
				var newLength       = oldLength + segmentLength;
				var newBuffer       = new ArrayBuffer(newLength);
				var newBufferObject = new Uint8Array(newBuffer, 0, newLength);
				
				var srcBufferLength = memory.data.bufferViews[i].byteLength; 
				var srcBuffer       = memory.data.buffer[i];
				var srcBufferObject = new Uint8Array(srcBuffer, 0, srcBufferLength);
				
				// Construct new resized buffer
				newBufferObject.set(oldBufferObject, 0);
				
				// Copy the information for the segment to the newBuffer
				var segmentData = srcBufferObject.slice(segmentStart, segmentEnd);
				
				if (indexBuffer)
				{
					var newMaxIndex = maxIndex;
					var indexData = new Uint16Array(segmentData.buffer);
					
					submesh.startIndex = maxIndex;
										
					for(var j = 0; j < indexData.length; j++)
					{
						var newIndex = indexData[j] + maxIndex;
						newMaxIndex = (newIndex > newMaxIndex) ? newIndex : newMaxIndex;
						indexData[j] = newIndex;
					}
					
					submesh.endIndex = newMaxIndex;
					maxIndex = newMaxIndex + 1;
				}
				
				// Store to remove later
				submesh.constructedBufferOffsets[segmentName] = oldLength;
				newBufferObject.set(segmentData, oldLength);
				memory.constructedBuffers[segmentName] = newBuffer;
			}
			
			_returnBuffers();			
		}
	}
	
	setTimeout("processQueue()",0);
};

processQueue();

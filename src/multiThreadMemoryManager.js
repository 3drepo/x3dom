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
			
			// Add everything to queue to be displayed as quickly as possible.
			addQueue.push(submesh.primitive.extras.refID);
		}
		
		msPerFrame = 1000.0 / event.data.ops;
		
	} else if (event.data.type === "changeVisibility") {
		// Pass in a list of IDs that need to be switched off
		// and switch on. Create a queue here to work through
		// based on a sorting mechanism.
		
		debugger;
	} else if (event.data.type === "returnBuffers") {
		for (i = 0; i < event.data.keys.length; i++)
		{
			var key = event.data.keys[i];
			memory.constructedBuffers[key] = event.data.buffers[i];
		}
		
		returned = true;
	}
	
	
};

function processQueue() {
	"use strict";
	
	if (returned)
	{
		while(addQueue.length)
		{
			//console.log("AQ: " + addQueue.length);
			
			if (!tickStart)
			{
				tickStart = new Date().getTime();
			}
					
			var first = addQueue.shift();
			var submesh = memory.submeshes[first];
			var segmentNames = Object.keys(memory.constructedBuffers);
			
			var indexBuffer;
			
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
					
					for(var j = 0; j < indexData.length; j++)
					{
						var newIndex = indexData[j] + maxIndex;
						newMaxIndex = (newIndex > newMaxIndex) ? newIndex : newMaxIndex;
						indexData[j] = newIndex;
					}
					
					maxIndex = newMaxIndex + 1;
				}
				
				newBufferObject.set(segmentData, oldLength);
				
				memory.constructedBuffers[segmentName] = newBuffer;
				
				/*
				console.log(segmentName + " NB: " + newBuffer.length + " OL: " + oldLength + " NL: " + newLength);
				
				var identical = true;
				
				for (i = 0; i < newBufferObject.length; i++)
				{
					if(newBufferObject[i] !== srcBufferObject[i])
					{
						identical = false;
						break;
					}
				}
				
				console.log("IDEN: " + identical + " [" + srcBufferObject.length + "] [" + newBufferObject.length + "]");
				*/
				
				//memory.constructedBuffers[segmentName].length = newLength;
			}
			
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
				
				//debugger;
							
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
				
				break;
			} 
		}
	}
	
	setTimeout("processQueue()",0);
};

processQueue();

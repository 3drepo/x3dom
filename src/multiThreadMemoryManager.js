/** @namespace x3dom.nodeTypes */
/*
 * X3DOM JavaScript Library
 * http://www.x3dom.org
 *
 * (C)2016 3DRepo London
 * Licensed under the MIT
 *
 * Author: Timothy Scully
 */

var msPerFrame = 5.0;

var processing = false;

var tickStart = null;
var returned = {};
var needPush = {};

var meshesCounters = {};

var meshesMemory = {};

var meshesVisibilityMap = {};
var meshesRemoveQueue = {};
var meshesAddQueue    = {};

var meshData          = {};

var visibleMeshIDs        = {};
var visibleMeshIDsChanged = {};
var visibleMeshData       = {};

function meshSort(a, b, meshData)
{
	"use strict";
	// Sorting function
	return 10.0 * (meshData[a].size - meshData[b].size) +
		(meshData[a].distance - meshData[b].distance);
}

// Counter intuitive but insertion sort is fast for almost
// already sorted arrays (which should be most of the time)
function insertionSort(values, sortFunction, meshData) {
	"use asm";
	"use strict";

	var length = values.length;

	for(var i = 1; i < length; ++i) {
		var temp = values[i];
		var j = i - 1;

		var testValue = sortFunction(values[j], values[i], meshData);

		for(; j >= 0 && testValue < 0; --j) {
			values[j+1] = values[j];
		}

    	values[j+1] = temp;
	}
};

var indexOf = function(arr, item) {
	"use strict";
	"use asm";

	for (var i=0, len=arr.length; i!==len ; i++) {
		if (arr[i] === item) { return i }
	}
	return -1;
};

function _addToQueues(addQueue, removeQueue, meshIDs, visibilityMap, memory)
{
	"use strict";
	var subMeshID;

	for (subMeshID in memory.submeshes)
	{
		var visible = (indexOf(meshIDs, subMeshID) > -1);

		if (visible)
		{
			var removeQueueIDX = indexOf(removeQueue,subMeshID);

			if (removeQueueIDX > -1)
			{
				removeQueue.splice(removeQueueIDX, 1);
			} else if (!visibilityMap[subMeshID]) {
				if (indexOf(addQueue,subMeshID) === -1)
				{
					addQueue.push(subMeshID);
				}
			}
		} else {
			var addQueueIDX = indexOf(addQueue,subMeshID);

			if (addQueueIDX > -1)
			{
				addQueue.splice(addQueueIDX, 1);
			} else if (visibilityMap[subMeshID]) {

				if (indexOf(removeQueue,subMeshID) === -1)
				{
					removeQueue.push(subMeshID);
				}
			}
		}
	}
};

onmessage = function(event) {
	"use strict";

	// For a register bufferView event, transfer the
	// memory to be held here. Along with a description
	// of how the sub-meshes constitute it.

	var i, memory = meshesMemory[event.data.id];
	var removeQueue = meshesRemoveQueue[event.data.id];
	var addQueue = meshesAddQueue[event.data.id];
	var visibilityMap = meshesVisibilityMap[event.data.id];

	if (event.data.type === "registerMe")
	{
		meshesMemory[event.data.id] = {};
		meshesRemoveQueue[event.data.id] = [];
		meshesAddQueue[event.data.id] = [];
		meshesCounters[event.data.id] = { primitiveCount: 0, maxIndex: 0 };
		meshesVisibilityMap[event.data.id] = {};
		visibleMeshIDs[event.data.id] = {};

		returned[event.data.id] = true;
		needPush[event.data.id] = true;

		addQueue = meshesAddQueue[event.data.id];
		removeQueue = meshesRemoveQueue[event.data.id];
		memory = meshesMemory[event.data.id];
		visibilityMap = meshesVisibilityMap[event.data.id];

		memory.data = event.data;

		// Create buffers spaces that are ready to upload to the GPU
		memory.constructedBuffers = {};
		memory.constructedBuffersLength = {};

		for (i = 0; i < event.data.bufferViews.length; i++)
		{
			var bufferView = event.data.bufferViews[i];
			var key        = bufferView.key;
			var length     = bufferView.byteLength;

			memory.constructedBuffers[key] = new ArrayBuffer(length);
			var newObject = new Uint8Array(memory.constructedBuffers[key]);
			var srcObject = new Uint8Array(bufferView.content);

			newObject.set(srcObject);

			memory.constructedBuffersLength[key] = 0;
		}

		// Build up a map from the ID of the submesh to
		// information about it's segmentation

		memory.submeshes = {};

		for(i = 0; i < event.data.submeshes.length; i++)
		{
			var submesh = event.data.submeshes[i];

			memory.submeshes[submesh.primitive.extras.refID] = submesh;
			memory.submeshes[submesh.primitive.extras.refID].constructedBufferOffsets = {};
			memory.submeshes[submesh.primitive.extras.refID].numIndex = 0;

			if (memory.submeshes[submesh.primitive.extras.refID].lodRef)
			{
				memory.submeshes[submesh.primitive.extras.refID].lod = 0;
			}

			// Add everything to queue to be displayed as quickly as possible.
			//addQueue.push(submesh.primitive.extras.refID);

			// Everything starts off invisible
			visibilityMap[submesh.primitive.extras.refID] = false;
		}

		msPerFrame = 1000.0 / event.data.ops;

		postMessage({
			type: "registered",
			destination: event.data.id
		});

	} else if (event.data.type === "changeVisibility") {
		// Pass in a list of IDs that need to be switched off
		// and switch on. Create a queue here to work through
		// based on a sorting mechanism.
		var meshIDs = Object.keys(event.data.meshes);

		/*
		addQueue    = [];
		removeQueue = [];

		meshesAddQueue[event.data.id]    = addQueue;
		meshesRemoveQueue[event.data.id] = removeQueue;
		*/

		visibleMeshIDs[event.data.id]        = meshIDs;
		visibleMeshIDsChanged[event.data.id] = true;
		visibleMeshData[event.data.id]       = event.data.meshes;


	} else if (event.data.type === "returnBuffers") {
		for (i = 0; i < event.data.keys.length; i++)
		{
			var key = event.data.keys[i];
			memory.constructedBuffers[key] = event.data.buffers[i];
			memory.constructedBuffersLength[key] = event.data.lengths[key];
		}

		returned[event.data.id] = true;
	}
};

function _returnBuffers(mesh, memory, counter, force) {
	"use strict";

	var elapsedTime = (new Date().getTime()) - tickStart;

	if (force || (elapsedTime > msPerFrame))
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
				destination: mesh,
				type: "bufferReady",
				keys: Object.keys(memory.constructedBuffers),
				lengths: memory.constructedBuffersLength,
				buffers: returnBuffers,
				count: counter.primitiveCount
			},
		returnBuffers);

		returned[mesh] = false;
		needPush[mesh] = false;

		tickStart = null;
	}
}

function _computeBuffers(ctx, memory, submesh, segmentName) {
	"use strict";
	"use asm";

	ctx.indexBuffer = !submesh.segments.hasOwnProperty(segmentName);

	if (!ctx.indexBuffer)
	{
		ctx.segmentLength = submesh.segments[segmentName].lengthBytes;
	} else {
		ctx.segmentLength = submesh.indices.lengthBytes;
	}

	ctx.segmentStart = submesh.constructedBufferOffsets[segmentName];
	ctx.segmentEnd   = ctx.segmentStart + ctx.segmentLength;

	ctx.oldBuffer       = memory.constructedBuffers[segmentName];
	ctx.oldLength       = memory.constructedBuffersLength[segmentName];
	ctx.oldBufferObject = new Uint8Array(ctx.oldBuffer);

/*
	ctx.newLength       = ctx.oldLength - ctx.segmentLength;
	ctx.newBuffer       = new ArrayBuffer(ctx.newLength);
	ctx.newBufferObject = new Uint8Array(ctx.newBuffer, 0, ctx.newLength);
*/

	memory.constructedBuffersLength[segmentName] -= ctx.segmentLength;

	ctx.preBuffer       = ctx.oldBufferObject.subarray(0, ctx.segmentStart);
	ctx.postBuffer      = ctx.oldBufferObject.subarray(ctx.segmentEnd);

	ctx.newBufferObject = ctx.oldBufferObject;
}

function _performReindexing(ctx, counter, submesh)
{
	"use strict";
	"use asm";

	var indexDelta = submesh.numIndex;
	counter.maxIndex = counter.maxIndex - indexDelta;

	var indexData = new Uint16Array(ctx.postBuffer.buffer, ctx.segmentEnd);

	//debugger;

	for (var j = 0; j < indexData.length; j++)
	{
		indexData[j] -= indexDelta;
	}

	counter.primitiveCount -= submesh.indices.count;
}

function _adjustOffsets(ctx, memory, segmentName)
{
	"use strict";
	"use asm";

	// Adjust other submesh offsets
	for (var subMeshID in memory.submeshes)
	{
		var otherSubMesh = memory.submeshes[subMeshID];

		if ("undefined" !== typeof otherSubMesh.constructedBufferOffsets[segmentName])
		{
			if(otherSubMesh.constructedBufferOffsets[segmentName] > ctx.segmentStart)
			{
				otherSubMesh.constructedBufferOffsets[segmentName] -= ctx.segmentLength;
			}
		}
	}
}

function _constructNewBufferObject(ctx, memory, submesh, segmentName)
{
	"use strict";
	"use asm";

	//ctx.newBufferObject.set(ctx.preBuffer, 0);
	ctx.newBufferObject.set(ctx.postBuffer, ctx.segmentStart);

	submesh.constructedBufferOffsets[segmentName] = -1;
	//memory.constructedBuffers[segmentName] = ctx.newBuffer;
}

function _addQueueComputeCTX(ctx, i, memory, counter, submesh, segmentName) {
	"use strict";
	"use asm";

	ctx.indexBuffer = !submesh.segments.hasOwnProperty(segmentName);

	if (!ctx.indexBuffer)
	{
		ctx.segmentLength = submesh.segments[segmentName].lengthBytes;
		ctx.segmentStart  = submesh.segments[segmentName].startBytes;
		ctx.segmentEnd    = submesh.segments[segmentName].endBytes;
	} else {
		ctx.segmentLength = submesh.indices.lengthBytes;
		ctx.segmentStart  = submesh.indices.startBytes;
		ctx.segmentEnd    = submesh.indices.endBytes;

		counter.primitiveCount += submesh.indices.count;
	}

	ctx.oldLength       = memory.constructedBuffersLength[segmentName];
	ctx.oldBuffer       = memory.constructedBuffers[segmentName];
	ctx.oldBufferObject = new Uint8Array(ctx.oldBuffer);

	/*
	ctx.newLength       = ctx.oldLength + ctx.segmentLength;
	ctx.newBuffer       = new ArrayBuffer(ctx.newLength);
	ctx.newBufferObject = new Uint8Array(ctx.newBuffer, 0, ctx.newLength);
	*/

	memory.constructedBuffersLength[segmentName] += ctx.segmentLength;

	ctx.srcBufferLength = memory.data.bufferViews[i].byteLength;
	ctx.srcBuffer       = memory.data.bufferViews[i].content;
	ctx.srcBufferObject = new Uint8Array(ctx.srcBuffer, 0, ctx.srcBufferLength);

	// Construct new resized buffer
	//ctx.newBufferObject.set(ctx.oldBufferObject, 0);
	ctx.newBufferObject = ctx.oldBufferObject;
	//memory.constructedBuffers[segmentName].byteLength;

	// Copy the information for the segment to the newBuffer
	ctx.segmentData = ctx.srcBufferObject.subarray(ctx.segmentStart, ctx.segmentEnd);
}

function _addQueuePerformReindexing(ctx, memory, counter, submesh, segmentName)
{
	"use strict";
	"use asm";

	var indexData = new Uint16Array(ctx.newBufferObject.buffer, ctx.oldLength, ctx.segmentLength / 2);

	//submesh.startIndex = counter.maxIndex;
	submesh.numIndex = submesh.indices.max + 1;

	for(var j = 0; j < indexData.length; j++)
	{
		indexData[j] += counter.maxIndex; //newIndex;
	}

	counter.maxIndex += submesh.numIndex;
}

var segmentNames, firstMesh, meshid, submesh, ctx, segmentName;
var memory, removeQueue, addQueue, counter, visibilityMap;
var meshIDs, mesh, i;

function processQueue() {
	"use asm";

	for (mesh in meshesMemory)
	{
		memory      = meshesMemory[mesh];
		removeQueue = meshesRemoveQueue[mesh];
		addQueue    = meshesAddQueue[mesh];
		counter     = meshesCounters[mesh];
		visibilityMap = meshesVisibilityMap[mesh];

		if (visibleMeshIDsChanged[mesh])
		{
			meshIDs = visibleMeshIDs[mesh];

			visibleMeshIDsChanged[mesh] = false;

			_addToQueues(addQueue, removeQueue, meshIDs, visibilityMap, memory);
			insertionSort(addQueue, meshSort, visibleMeshData[mesh]);
		}

		if (returned[mesh])
		{
			/*
			if (addQueue.length || removeQueue.length)
			{
				console.log("MESH: " + mesh + " AQ: " + addQueue.length + " RQ: " + removeQueue.length);
			}*/

			// First deal with removing objects from buffer
			while(returned[mesh] && removeQueue.length)
			{
				if (!tickStart)
				{
					tickStart = new Date().getTime();
					needPush[mesh] = true;
				}

				meshid    = removeQueue.shift();
				//meshid       = firstMesh.id;
				submesh      = memory.submeshes[meshid];
				segmentNames = Object.keys(memory.constructedBuffers);

				// Now visible
				visibilityMap[meshid] = false;

				// Cut submesh out of buffer
				for (i = 0; i < segmentNames.length; i++)
				{
					segmentName = segmentNames[i];
					ctx = {};

					_computeBuffers(ctx, memory, submesh, segmentName);

					// Must re-index everything
					if (ctx.indexBuffer)
					{
						_performReindexing(ctx, counter, submesh);
					}

					_adjustOffsets(ctx, memory, segmentName);

					_constructNewBufferObject(ctx, memory, submesh, segmentName);
				}

				_returnBuffers(mesh, memory, counter, false);
			}

			// Next, deal with adding object to buffer
			while(returned[mesh] && addQueue.length)
			{
				if (!tickStart)
				{
					tickStart = new Date().getTime();
					needPush[mesh] = true;
				}

				meshid    = addQueue.shift();
				//meshid       = firstMesh.id;
				submesh      = memory.submeshes[meshid];
				segmentNames = Object.keys(memory.constructedBuffers);

				// Now visible
				visibilityMap[meshid] = true;

				for (i = 0; i < segmentNames.length; i++)
				{
					segmentName = segmentNames[i];
					ctx = {};

					_addQueueComputeCTX(ctx, i, memory, counter, submesh, segmentName);

					// Copy the data to the newBufferObject
					ctx.newBufferObject.set(ctx.segmentData, ctx.oldLength);

					if (ctx.indexBuffer)
					{
						_addQueuePerformReindexing(ctx, memory, counter, submesh, segmentName);
					}

					// Store to remove later
					submesh.constructedBufferOffsets[segmentName] = ctx.oldLength;
					//memory.constructedBuffers[segmentName] = ctx.newBuffer;
				}

				_returnBuffers(mesh, memory, counter, false);
			}

			// Push any remaining changes that may have
			if (needPush[mesh] && returned[mesh])
			{
				_returnBuffers(mesh, memory, counter, true);
			}
		}
	}

	setTimeout(processQueue, msPerFrame);
};

processQueue();

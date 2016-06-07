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

var glTFHeader = {};
var glTFPartitioning = {};

(function() {
	"use strict";

	var glTFAsset = function(asset) {
		this.generator = asset.generator;
		this.version = asset.version;
	};

	var glTFSceneExtras = function(extras) {
		this.partitioning = extras.partitioning;
	};

	var glTFScene = function(scene) {
		this.nodes = scene.nodes;

		this.extras = new glTFSceneExtras(scene.extras);
	};

	var glTFBufferViewExtras = function(extras)
	{
		this.refID = extras.refID;
	};

	var glTFBufferView = function(bufferView) {
		this.buffer = bufferView.buffer;
		this.byteLength = bufferView.byteLength;
		this.byteOffset = bufferView.byteOffset;
		this.target = bufferView.target;
		this.extras = new glTFBufferViewExtras(bufferView.extras);
	};

	var glTFAccessors = function(accessor) {
		this.bufferView = accessor.bufferView;
		this.byteOffset = accessor.byteOffset;
		this.byteStride = accessor.byteStride;
		this.componentType = accessor.componentType;
		this.count = accessor.count;
		this.min = accessor.min;
		this.max = accessor.max;
		this.type = accessor.type;
		this.extras = new glTFBufferViewExtras(accessor.extras);
	};

	var glTFPrimitiveAttrs = function(attrs) {
		this.NORMAL = attrs.NORMAL;
		this.POSITION = attrs.POSITION;
		this.IDMAP = attrs.IDMAP;
	};

	var glTFPrimitive = function(primitive) {
		this.material = primitive.material;
		this.mode     = primitive.mode;
		this.indices  = primitive.indices;
		this.attributes = new glTFPrimitiveAttrs(primitive.attributes);
		this.extras    = new glTFBufferViewExtras(primitive.extras);
	};

	var glTFMesh = function(mesh) {
		this.primitives = [];

		for(var i = 0; i < mesh.primitives.length; i++)
		{
			this.primitives.push(new glTFPrimitive(mesh.primitives[i]));
		}
	};

	var glTFNode = function(node) {
		this.name = node.name;
		this.meshes = node.meshes;
	};

	var glTFParameter = function(param)
	{
		this.semantic = param.semantic;
		this.type = param.type;
		this.value = param.value;
	};

	var glTFTechnique = function(technique)
	{
		this.parameters = {};

		for(var param in technique.parameters)
		{
			this.parameters[param] = new glTFParameter(technique.parameters[param]);
		}

		this.program = technique.program;
		this.states = technique.states;
		this.uniforms = technique.uniforms;
		this.attributes = technique.attributes;
		this.extras      = technique.extras;
	};

	var glTFX3DMaterial = function (x3dmaterial) {
		this.diffuseColor = x3dmaterial.diffuseColor;
		this.backDiffuseColor = x3dmaterial.backDiffuseColor;
		this.specularColor = x3dmaterial.specularColor;
		this.backSpecularColor = x3dmaterial.backSpecularColor;
		this.shininess = x3dmaterial.shininess;
		this.backShininess = x3dmaterial.backShininess;
		this.transparency = x3dmaterial.transparency;
		this.backTransparency = x3dmaterial.backTransparency;
	};

	var glTFMaterialExtras = function (extras) {
		this.x3dmaterial = new glTFX3DMaterial(extras.x3dmaterial);
	};

	var glTFMaterial = function(material)
	{
		this.technique = material.technique;
		this.name = material.name;
		this.extras = new glTFMaterialExtras(material.extras);

		this.values = {
			diffuse : material.values.diffuse,
			specular :material.values.specular,
			shininess: material.values.shininesss,
			transparency: material.values.transparency,
			twoSided: material.values.twoSided
		};

	};

	var glTFBuffer = function(buffer) {
		this.byteLength = buffer.byteLength;
		this.type = buffer.type;
		this.uri = buffer.uri;
	};

	glTFHeader = function(obj){
		this.asset = new glTFAsset(obj.asset);
		this.scene = obj.scene;
		this.scenes = {};

		for(var sceneName in obj.scenes)
		{
			this.scenes[sceneName] = new glTFScene(obj.scenes[sceneName]);
		}

		this.bufferViews = {};

		for(var bufferView in obj.bufferViews)
		{
			this.bufferViews[bufferView] = new glTFBufferView(obj.bufferViews[bufferView]);
		}

		this.accessors = {};

		for(var accessor in obj.accessors)
		{
			this.accessors[accessor] = new glTFAccessors(obj.accessors[accessor]);
		}

		this.meshes = {};

		for(var mesh in obj.meshes)
		{
			this.meshes[mesh] = new glTFMesh(obj.meshes[mesh]);
		}

		this.nodes = {};

		for(var node in obj.nodes)
		{
			this.nodes[node] = new glTFNode(obj.nodes[node]);
		}

		this.techniques = {};

		for(var technique in obj.techniques)
		{
			this.techniques[technique] = new glTFTechnique(obj.techniques[technique]);
		}

		this.materials = {};

		for(var material in obj.materials)
		{
			this.materials[material] = new glTFMaterial(obj.materials[material]);
		}

		this.buffers = {};

		for(var buffer in obj.buffers)
		{
			this.buffers[buffer] = new glTFBuffer(obj.buffers[buffer]);
		}

		this.samplers = obj.samplers;
		this.shaders = obj.shaders;
		this.programs = obj.programs;
	};

	var glTFPartNodeMesh = function(mesh)
	{
		this.min = mesh.min;
		this.max = mesh.max;
	};

	var glTFPartNode = function(node, left, right)
	{
		this.axis = node.axis;
		this.value = node.value;

		if(node.meshes)
		{
			this.meshes = {};

			for(var mesh in node.meshes)
			{
				this.meshes[mesh] = new glTFPartNodeMesh(node.meshes[mesh]);
			}
		} else {
			this.left = left;
			this.right = right;
		}
	};

	glTFPartitioning = function(node)
	{
		if (!node.meshes)
		{
			var leftNode = glTFPartitioning(node.left);
			var rightNode = glTFPartitioning(node.right);
			return new glTFPartNode(node, leftNode, rightNode);
		} else {
			return new glTFPartNode(node);
		}
	};
})();

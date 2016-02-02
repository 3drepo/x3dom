/** @namespace x3dom.nodeTypes */
/*
 * X3DOM JavaScript Library
 * http://www.x3dom.org
 *
 * (C)2016 3DRepo Ltd, London
 * Licensed under the MIT
 *
 * Author: Sebastian Friston
 */

// ### glTF ###
x3dom.registerNodeType(
    "glTF",
    "Networking",
    defineClass(x3dom.nodeTypes.X3DGroupingNode,

        /**
         * Constructor for glTF
         * @constructs x3dom.nodeTypes.glTF
         * @x3d 3.3
         * @component Networking
         * @status full
         * @extends x3dom.nodeTypes.X3DGroupingNode
         * @param {Object} [ctx=null] - context object, containing initial settings like namespace
         * @classdesc glTF is a Grouping node that hosts a glTF (https://github.com/KhronosGroup/glTF) scene description.
         * The scene graph described in the glTF header is instantiated as a set of X3DOM nodes, but created explicitly
         * rather than via the XML DOM.
         */
        function (ctx) {
            x3dom.nodeTypes.glTF.superClass.call(this, ctx);

            /**
             * Address of the glTF header file. This is the JSON that describes the scene hierarchy and the location of the
             * binary resources.
             * @var {x3dom.fields.MFString} url
             * @memberof x3dom.nodeTypes.glTF
             * @initvalue []
             * @field x3d
             * @instance
             */
            this.addField_MFString(ctx, 'url', []);
        },
        {
            nodeChanged: function ()
            {
                x3dom.debug.logInfo('nodeChanged glTF');
                if (!this.initDone) {
                    this._load();
                }
            },

            /**
             * Loads the scene graph defined in url as a child of the current node. This does not currently remove
             * any existing nodes so do not call it twice.
             */
            _load: function ()
            {
                if (this._vf.url.length && this._vf.url[0].length) {

                    this.initDone = true;

                    x3dom.debug.logInfo('loading glTF');

                    var that = this;

                    var uri = this._nameSpace.getURL(this._vf.url[0]);

                    that._uri = uri;
                    that._path = uri.substr(0, uri.lastIndexOf('/') + 1);

                    //TODO: does this work for embedded (data:) uris?
                    this._nameSpace.doc.manageDownload(uri, "text/json", function(xhr) {
                        that._onceLoaded(xhr);
                    });
                }
            },

            _onceLoaded: function(xhr){

                var that = this;

                // set up the objects gltf specific properties
                this._gltf = {};
                this._gltf._header = JSON.parse(xhr.responseText);

                var header = this._gltf._header;

                // get the scene object - this will be the graph thats added to the dom
                var scene = header.scenes[header.scene];

                // create the scene dom in x3d
                var sceneDom = that._createSceneDOM(scene);

                //debug
                 var xmlString = (new XMLSerializer()).serializeToString(sceneDom);

                // create the scene graph and add it to the current graph
                var newScene = this._nameSpace.setupTree(sceneDom.documentElement);

                that.addChild(newScene);
                that.invalidateVolume();
                that._nameSpace.doc.needRender = true;
            },

            _createSceneDOM: function(scene){

                var that    = this;
                var header  = this._gltf._header;

                // create the xml document to hold the scene. Every node in the gltf scene graph (for now at least)
                // is a transform. gltf scene nodes have a 'meshes' property - these meshes will be added as child
                // Shape elements, under the Transform element, that is the scene node itself

                //todo: we could make this a scene node if we get the namespace setup right
                var sceneDoc = document.implementation.createDocument(null, "Transform");
                var sceneNode = sceneDoc.documentElement;

                // walk the scene graph (_createChild is recursive) to create x3d nodes
                scene.nodes.forEach(function(node) {
                    sceneNode.appendChild(that._createChild(sceneDoc, header.nodes[node]));
                });

                return sceneDoc;
            },

            _createChild: function(sceneDoc, gltfNode){

                var that    = this;
                var header  = this._gltf._header;

                // create a transform node to hold the mesh nodes and other child nodes. all gltf scene nodes are
                // Transforms

                var newNode = sceneDoc.createElement("Transform");

                //todo: configure the transform attributes with the transformations from the grpah

                // add any meshes of this node as as new glTFGeometry nodes
                if(gltfNode.meshes) {
                    gltfNode.meshes.forEach(function(mesh) {
                        newNode.appendChild(that._createShapeNode(sceneDoc, mesh));
                    });
                }

                // finally process all the children
                if(gltfNode.children) {
                    gltfNode.children.forEach(function(child) {
                        newNode.appendChild(that._createChild(sceneDoc, header.nodes[child]));
                    });
                }

                return newNode;
            },

            /*
             * Creates a new X3DShape node, with the geometry and appearance elements initialised to new glTFGeometry and
             * Appearance nodes. The content of the nodes are set by querying the ._gltf._header parameter for the
             * properties of the mesh with the name/index 'meshname'
             */
            _createShapeNode: function(sceneDoc, meshname){

                var that    = this;
                var header  = this._gltf._header;

                // create the shape node - this will render a primitive
                var shapeNode = sceneDoc.createElement("Shape");

                // create and apply the gltfgeometry node as the geometry part of the shape
                var geometryNode = sceneDoc.createElement("glTFGeometry");
                geometryNode.setAttribute("url", that._uri);
                geometryNode.setAttribute("mesh", meshname);
                //because the dom is being passed directly (not being encoded and parsed) we can pass objects
                geometryNode.gltfHeader = header;
                geometryNode.gltfHeaderBaseURI = that._path;

                shapeNode.appendChild(geometryNode);

                // create and apply the appearance node from the mesh material
                //todo: set the material

                var appearenceNode = sceneDoc.createElement("Appearance");
                shapeNode.appendChild(appearenceNode);
                var materialNode = sceneDoc.createElement("Material");
                appearenceNode.appendChild(materialNode);
                materialNode.setAttribute("diffuseColor", "1 0 0");

                return shapeNode;
            },


            handleTouch: function() {
                var url = this._vf.url.length ? this._vf.url[0] : "";
                var aPos = url.search("#");
                var anchor = "";
                if (aPos >= 0)
                    anchor = url.slice(aPos+1);

                var param = this._vf.parameter.length ? this._vf.parameter[0] : "";
                var tPos = param.search("target=");
                var target = "";
                if (tPos >= 0)
                    target = param.slice(tPos+7);

                // TODO: implement #Viewpoint bind
                // http://www.web3d.org/files/specifications/19775-1/V3.2/Part01/components/networking.html#Anchor
                x3dom.debug.logInfo("Anchor url=" + url + ", target=" + target + ", #viewpoint=" + anchor);

                if(target.length !=0 || target != "_self") {
                    window.open(this._nameSpace.getURL(url), target);
                }
                else {
                    window.location = this._nameSpace.getURL(url);
                }
            }
        }
    )
);
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

                // walk the scene graph (_createChild is recursive) to create x3d nodes
                scene.nodes.forEach(
                    function(element, number, array){
                        that._createChild(that, header.nodes[element]);
                });
            },

            _createChild: function(x3dparent, gltfnode){

                var that    = this;
                var header  = this._gltf._header;

                // create a transform node to hold the mesh nodes and other child nodes

                var newNode = that._createTransformNode(gltfnode);

                x3dparent.addChild(newNode, "children");

                // add any meshes of this node as as new glTFGeometry nodes

                if(gltfnode.meshes) {
                    gltfnode.meshes.forEach(
                        function (element) {
                            //todo: create a new containerfield for the meshes
                            newNode.addChild(that._createShapeNode(element), "children");
                        });
                }

                // finally process all the children

                if(gltfnode.children) {
                    gltfnode.children.forEach(
                        function (element) {
                            that._createChild(newNode, header.nodes[element]);
                        });
                }
            },

            _createTransformNode: function(gltfnode){

                var that = this;

                //TODO: another way to do this may be to update the xmldom itself?
                var nodeType = x3dom.nodeTypesLC["transform"];
                var ctx = {
                    doc: that._nameSpace.doc,
                    xmlNode: that._xmlNode,     //todo: this cannot be a good idea...
                    nameSpace: that._nameSpace
                };
                var newNode = new nodeType(ctx);

                if(gltfnode.name) {
                    newNode.name = gltfnode.name;
                }

                // todo: initialise the transform matrix

                return newNode;
            },

            /*
             * Creates a new X3DShape node, with the geometry and appearance elements initialised to new glTFGeometry and
             * Appearance nodes. The content of the nodes are set by querying the ._gltf._header parameter for the
             * properties of the mesh with the name/index 'meshname'
             */
            _createShapeNode: function(meshname){

                var that    = this;
                var header  = this._gltf._header;

                // create the shape node

                var shape = that._makeNewNode("shape");

                // initialise the geometry

                var geometry = that._makeNewNode("gltfgeometry");
                shape.addChild(geometry, "geometry");

                geometry.gltfHeader = that._gltf._header;

                //todo: use the xmlNode member of ctx in _makeNewNode to pass in parameters (other than .gltfHeadaer, which is an object)
                geometry._vf.mesh = meshname;

                // initialise the appearance

                var appearance = that._makeNewNode("appearance");
         //       shape.addChild(appearance, "appearance");



                return shape;
            },

            _makeNewNode: function(nodeTypeName){

                var that = this;

                var gltfNamespace = new x3dom.NodeNameSpace(that._nameSpace.name, that._nameSpace.doc);
                gltfNamespace.setBaseURL(that._path);

                var nodeType = x3dom.nodeTypesLC[nodeTypeName];
                var ctx = {
                    doc: that._nameSpace.doc,
                    xmlNode: that._xmlNode,     //todo: this cannot be a good idea...
                    nameSpace: gltfNamespace
                };
                var newNode = new nodeType(ctx);

                return newNode;

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
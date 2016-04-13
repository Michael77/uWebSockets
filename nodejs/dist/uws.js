'use strict';

const EventEmitter = require('events');

const uws = require(`./uws_${process.platform}_${process.versions.modules}`);
const NativeServer = uws.Server;
const EE_ERROR = Error("registering more than one listener to websocket");

class Socket {
    /**
     * Creates a Socket instance.
     *
     * @param {Object} nativeSocket Socket instance
     * @param {Server} server Server instance
     */
    constructor(nativeSocket, server) {
        this.nativeSocket = nativeSocket;
        this.server = server;
    }

    /**
     * Registers a callback for given eventName
     *
     * @param {String} eventName
     * @param {Function} f
     */
    on(eventName, f) {
        if (eventName === 'message') {
            if (this.messageCallback) {
                throw EE_ERROR;
            }
            this.messageCallback = f;
        } else if (eventName === 'close') {
            if (this.disconnectionCallback) {
                throw EE_ERROR;
            }
            this.disconnectionCallback = f;
        }
    }

    /**
     * Removes all registered callbacks for the given eventName
     * or, in the case of no eventName, all registered callbacks
     *
     * @param {String} eventName optional
     */
    removeAllListeners(eventName) {
        if (!eventName || eventName === 'message') {
            this.messageCallback = undefined;
        }
        if (!eventName || eventName === 'close') {
            this.disconnectionCallback = undefined;
        }
        return this;
    }

    /**
     * Sends a message.
     *
     * @param {String|Buffer} message The message to send
     * @param {Object} options Send options
     * @public
     */
    send(message, options) {
        /* ignore sends on closed sockets */
        if (!this.nativeSocket) return;

        const binary = options && options.binary || false;
        this.server.nativeServer.send(this.nativeSocket, message, binary);
    }

    /**
     * Closes the socket.
     *
     * @public
     */
    close() {
        /* ignore close on closed sockets */
        if (!this.nativeSocket) return;

        this.server.nativeServer.close(this.nativeSocket);
        this.server = this.nativeSocket = undefined;
    }
}

class Server extends EventEmitter {
    /**
     * Creates a Server instance.
     *
     * @param {Object} options Configuration options
     */
    constructor(options) {
        super();
        /* we currently do only support port as option */
        this.nativeServer = new NativeServer(options.port);

        /* emit error if the server is in a broken state */
        this.on('newListener', (eventName, f) => {
            if (eventName === 'error' && this.nativeServer.error) {
                f('EADDRINUSE');
            }
        });

        /* only register events if the server is valid */
        if (!this.nativeServer.error) {
            this.nativeServer.onConnection((nativeSocket) => {
                const socket = new Socket(nativeSocket, this);
                this.nativeServer.setData(nativeSocket, socket);
                this.emit('connection', socket);
            });

            this.nativeServer.onDisconnection((nativeSocket, socket) => {
                if (socket.disconnectionCallback) {
                    socket.disconnectionCallback();
                }
                /* make sure to clear any set data */
                this.nativeServer.setData(nativeSocket);
            });

            this.nativeServer.onMessage((nativeSocket, message, binary, socket) => {
                if (socket.messageCallback) {
                    socket.messageCallback(binary ? message : message.toString());
                }
            });
        }
    }

    /**
     * Closes the server.
     *
     * @public
     */
    close() {
        this.nativeServer.close();
    }

    /**
     * Broadcast a message to all sockets.
     *
     * @param {String|Buffer} message The message to broadcast
     * @param {Object} options Broadcast options
     * @public
     */
    broadcast(message, options) {
        /* only listen to binary option */
        this.nativeServer.broadcast(message, options && options.binary || false);
    }

    /**
     * Handles a HTTP Upgrade request.
     *
     * @param {http.IncomingMessage} request HTTP request
     * @param {net.Socket} Socket between server and client
     * @param {Buffer} upgradeHead The first packet of the upgraded stream
     * @param {Function} callback Callback function
     * @public
     */
    handleUpgrade(request, socket, upgradeHead, callback) {
        /* register a special connection handler */
        this.nativeServer.onConnection((nativeSocket) => {
            const sock = new Socket(nativeSocket, this);
            this.nativeServer.setData(nativeSocket, sock);

            /* internal variables */
            sock.upgradeReq = request;
            callback(sock);

            /* todo: reset connection handler when the upgrade queue is empty */
            /* this will probably never be noticed as you don't mix upgrade handling */
        });

        /* upgrades will be handled immediately */
        this.nativeServer.upgrade(socket._handle.fd, request.headers['sec-websocket-key']);
        socket.destroy();
    }
}

exports.Server = Server;
exports.uws = uws;

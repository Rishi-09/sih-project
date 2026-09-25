"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSocketGateway = createSocketGateway;
const socket_io_1 = require("socket.io");
const config_1 = require("../config");
/** Rooms per run (`run:<id>`) — costs one line and is what makes a future
 * fleet-of-3 view possible without any rework. See published plan §B5. */
function createSocketGateway(httpServer) {
    const io = new socket_io_1.Server(httpServer, {
        cors: { origin: config_1.config.corsOrigin, methods: ["GET", "POST"] },
    });
    io.on("connection", (socket) => {
        socket.on("run:join", ({ runId }) => {
            if (runId)
                socket.join(`run:${runId}`);
        });
        socket.on("run:leave", ({ runId }) => {
            if (runId)
                socket.leave(`run:${runId}`);
        });
    });
    return io;
}
//# sourceMappingURL=gateway.js.map
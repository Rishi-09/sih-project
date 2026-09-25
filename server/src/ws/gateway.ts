import { Server as SocketIOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import { config } from "../config";

/** Rooms per run (`run:<id>`) — costs one line and is what makes a future
 * fleet-of-3 view possible without any rework. See published plan §B5. */
export function createSocketGateway(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: config.corsOrigin, methods: ["GET", "POST"] },
  });

  io.on("connection", (socket) => {
    socket.on("run:join", ({ runId }: { runId: string }) => {
      if (runId) socket.join(`run:${runId}`);
    });
    socket.on("run:leave", ({ runId }: { runId: string }) => {
      if (runId) socket.leave(`run:${runId}`);
    });
  });

  return io;
}

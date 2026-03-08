import { Buffer } from "buffer";
import * as FileSystem from "expo-file-system";
import TcpSocket from "react-native-tcp-socket";

export class LocalFileServer {
  private server: TcpSocket.Server | null = null;
  public port = 8080;
  public isRunning = false;

  // Track the current file being offered
  public currentFileUri: string | null = null;
  public currentFileSize: number = 0;
  public currentFileName: string = "download.ext";
  public currentMimeType: string = "application/octet-stream";

  start(port = 8080) {
    if (this.isRunning) return;
    this.port = port;

    this.server = TcpSocket.createServer((socket) => {
      socket.once("data", async (data) => {
        const request = data.toString();

        // Simple HTTP Request Router
        if (request.startsWith("GET /download")) {
          if (!this.currentFileUri) {
            socket.write("HTTP/1.1 404 Not Found\r\n\r\nFile Not Shared");
            socket.end();
            return;
          }

          console.log(`[FileServer] 🌐 Serving file: ${this.currentFileName}`);

          // Standard HTTP Headers
          const headers = [
            "HTTP/1.1 200 OK",
            `Content-Type: ${this.currentMimeType}`,
            `Content-Length: ${this.currentFileSize}`,
            `Content-Disposition: attachment; filename="${this.currentFileName}"`,
            "Connection: close", // End stream automatically after closing socket
            "",
            "",
          ].join("\r\n");

          socket.write(headers);

          // Stream the file in 64KB chunks to avoid JS Out-Of-Memory crashes
          const CHUNK_SIZE = 65536;
          let position = 0;

          const streamNextChunk = async () => {
            if (!this.currentFileUri || socket.destroyed) return;

            if (position >= this.currentFileSize) {
              console.log(
                `[FileServer] ✅ File transfer complete: ${this.currentFileName}`,
              );
              socket.end();
              return;
            }

            const length = Math.min(
              CHUNK_SIZE,
              this.currentFileSize - position,
            );

            try {
              const base64Chunk = await FileSystem.readAsStringAsync(
                this.currentFileUri,
                {
                  encoding: "base64" as any,
                  position,
                  length,
                },
              );

              const buffer = Buffer.from(base64Chunk, "base64");
              socket.write(buffer, undefined, () => {
                position += length;
                streamNextChunk(); // Loop recursively when write flushes
              });
            } catch (err) {
              console.error("[FileServer] ❌ Chunk read error:", err);
              socket.end();
            }
          };

          streamNextChunk();
        } else {
          socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
          socket.end();
        }
      });

      socket.on("error", (err) => console.log("[FileServer] Socket err:", err));
    });

    this.server.on("error", (err) =>
      console.error("[FileServer] Server Error:", err),
    );

    this.server.listen({ port: this.port, host: "0.0.0.0" }, () => {
      this.isRunning = true;
      console.log(
        `[FileServer] 🚀 Native Local HTTP Server running on port ${this.port}`,
      );
    });
  }

  setFile(uri: string, size: number, name: string, mime: string) {
    this.currentFileUri = uri;
    this.currentFileSize = size;
    this.currentFileName = name;
    this.currentMimeType = mime;
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.isRunning = false;
    this.currentFileUri = null;
    console.log("[FileServer] 🛑 Server stopped");
  }
}

export const fileServer = new LocalFileServer();

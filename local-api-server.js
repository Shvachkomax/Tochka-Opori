import http from "node:http";
import { Readable } from "node:stream";

import analyzeHandler from "./api/analyze.js";
import transcribeHandler from "./api/transcribe.js";

const PORT = 3001;

function createReqRes(nodeReq, nodeRes, bodyBuffer) {
  const req = Readable.from(bodyBuffer || []);
  req.method = nodeReq.method;
  req.url = nodeReq.url;
  req.headers = nodeReq.headers;

  const res = {
    statusCode: 200,
    headers: {},

    status(code) {
      this.statusCode = code;
      return this;
    },

    setHeader(name, value) {
      this.headers[name] = value;
    },

    json(data) {
      nodeRes.writeHead(this.statusCode, {
        "Content-Type": "application/json",
        ...this.headers,
      });
      nodeRes.end(JSON.stringify(data));
    },

    send(data) {
      nodeRes.writeHead(this.statusCode, this.headers);
      nodeRes.end(data);
    },
  };

  try {
    if (bodyBuffer?.length) {
      const contentType = nodeReq.headers["content-type"] || "";
      if (contentType.includes("application/json")) {
        req.body = JSON.parse(bodyBuffer.toString("utf8"));
      }
    }
  } catch {
    req.body = {};
  }

  return { req, res };
}

const server = http.createServer(async (nodeReq, nodeRes) => {
  try {
    const chunks = [];

    for await (const chunk of nodeReq) {
      chunks.push(chunk);
    }

    const bodyBuffer = Buffer.concat(chunks);
    const { req, res } = createReqRes(nodeReq, nodeRes, bodyBuffer);

    if (nodeReq.url.startsWith("/api/analyze")) {
      return analyzeHandler(req, res);
    }

    if (nodeReq.url.startsWith("/api/transcribe")) {
      return transcribeHandler(req, res);
    }

    nodeRes.writeHead(404, { "Content-Type": "application/json" });
    nodeRes.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    nodeRes.writeHead(500, { "Content-Type": "application/json" });
    nodeRes.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Local API server running at http://localhost:${PORT}`);
});

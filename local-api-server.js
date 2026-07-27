import dotenv from "dotenv";
import http from "node:http";
import { Readable } from "node:stream";

dotenv.config({ path: ".env.local" });

import analyzeHandler from "./api/analyze.js";
import transcribeHandler from "./api/transcribe.js";
import sessionHandler from "./api/session.js";
import reviewsHandler from "./api/reviews.js";
import expertsHandler from "./api/experts.js";
import adminHandler from "./api/admin.js";
import crisisHandler from "./api/crisis.js";
import councilHandler from "./api/council.js";

const PORT = 3001;

function createReqRes(nodeReq, nodeRes, bodyBuffer) {
  const req = Readable.from(Buffer.isBuffer(bodyBuffer) ? bodyBuffer : []);
  req.method = nodeReq.method;
  req.url = nodeReq.url;
  req.headers = nodeReq.headers;

  const res = {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(data) {
      nodeRes.writeHead(this.statusCode, { "Content-Type": "application/json", ...this.headers });
      nodeRes.end(JSON.stringify(data));
    },
    send(data) {
      nodeRes.writeHead(this.statusCode, this.headers);
      nodeRes.end(data);
    },
  };

  try {
    if (bodyBuffer?.length) {
      const ct = nodeReq.headers["content-type"] || "";
      if (ct.includes("application/json")) {
        req.body = JSON.parse(bodyBuffer.toString("utf8"));
      }
    }
  } catch { req.body = {}; }

  return { req, res };
}

const server = http.createServer(async (nodeReq, nodeRes) => {
  try {
    const chunks = [];
    for await (const chunk of nodeReq) chunks.push(chunk);
    const bodyBuffer = Buffer.concat(chunks);
    const { req, res } = createReqRes(nodeReq, nodeRes, bodyBuffer);

    if (nodeReq.url.startsWith("/api/analyze")) {
      return analyzeHandler(req, res);
    }
    if (nodeReq.url.startsWith("/api/transcribe")) {
      return transcribeHandler(req, res);
    }
    if (nodeReq.url.startsWith("/api/session")) {
      return sessionHandler(req, res);
    }
    if (nodeReq.url.startsWith("/api/reviews")) {
      return reviewsHandler(req, res);
    }
    if (nodeReq.url.startsWith("/api/experts")) {
      return expertsHandler(req, res);
    }
    if (nodeReq.url.startsWith("/api/admin")) {
      return adminHandler(req, res);
    }
    if (nodeReq.url.startsWith("/api/crisis")) {
      return crisisHandler(req, res);
    }
    if (nodeReq.url.startsWith("/api/council")) {
      return councilHandler(req, res);
    }

    nodeRes.writeHead(404, { "Content-Type": "application/json" });
    nodeRes.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    console.error("API error:", error);
    nodeRes.writeHead(500, { "Content-Type": "application/json" });
    nodeRes.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Local API server running at http://localhost:${PORT}`);
});

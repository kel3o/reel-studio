'use strict';

const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_BYTES = 8 * 1024 * 1024;

function encodeFrame(opcode, data) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

function accept(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return null;
  }
  const digest = crypto.createHash('sha1').update(String(key) + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' +
      digest +
      '\r\n\r\n'
  );
  return wrap(socket, head && head.length ? Buffer.from(head) : Buffer.alloc(0));
}

function wrap(socket, head) {
  let buffer = head;
  let fragments = [];
  let fragOpcode = 0;
  const handlers = { message: null, close: null };
  let closed = false;

  function emitClose() {
    if (closed) return;
    closed = true;
    if (handlers.close) handlers.close();
  }

  function consume() {
    while (!closed) {
      if (buffer.length < 2) return;
      const b0 = buffer[0];
      const b1 = buffer[1];
      const opcode = b0 & 0x0f;
      const fin = (b0 & 0x80) !== 0;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_BYTES)) {
          socket.destroy();
          return;
        }
        len = Number(big);
        offset = 10;
      }
      if (len > MAX_BYTES) {
        socket.destroy();
        return;
      }
      const maskLen = masked ? 4 : 0;
      if (buffer.length < offset + maskLen + len) return;
      let payload = buffer.subarray(offset + maskLen, offset + maskLen + len);
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4);
        const copy = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) copy[i] = payload[i] ^ mask[i & 3];
        payload = copy;
      } else if (payload.length) {
        payload = Buffer.from(payload);
      }
      buffer = buffer.subarray(offset + maskLen + len);

      if (opcode === 0x8) {
        try {
          socket.write(encodeFrame(0x8, Buffer.alloc(0)));
        } catch (err) {
          // the other side already left
        }
        socket.end();
        emitClose();
        return;
      }
      if (opcode === 0x9) {
        socket.write(encodeFrame(0xa, payload));
        continue;
      }
      if (opcode === 0xa) continue;

      if (opcode === 0x0) {
        fragments.push(payload);
      } else if (opcode === 0x1 || opcode === 0x2) {
        fragments = [payload];
        fragOpcode = opcode;
      } else {
        continue;
      }
      if (!fin) continue;
      const msg = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments);
      fragments = [];
      if (handlers.message) handlers.message(fragOpcode === 0x2, msg);
    }
  }

  socket.setNoDelay(true);
  socket.on('data', (chunk) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    try {
      consume();
    } catch (err) {
      socket.destroy();
    }
  });
  socket.on('end', () => {
    socket.end();
    emitClose();
  });
  socket.on('close', emitClose);
  socket.on('error', () => {
    socket.destroy();
    emitClose();
  });
  if (buffer.length) {
    try {
      consume();
    } catch (err) {
      socket.destroy();
    }
  }

  return {
    sendText(text) {
      if (closed) return;
      socket.write(encodeFrame(0x1, Buffer.from(String(text))));
    },
    sendBinary(buf) {
      if (closed) return;
      socket.write(encodeFrame(0x2, Buffer.isBuffer(buf) ? buf : Buffer.from(buf)));
    },
    close() {
      if (closed) return;
      try {
        socket.write(encodeFrame(0x8, Buffer.alloc(0)));
      } catch (err) {
        // already gone
      }
      socket.end();
      emitClose();
    },
    on(name, fn) {
      handlers[name] = fn;
    },
  };
}

module.exports = { accept };

import tls from "node:tls";

function issuerName(issuer) {
  if (!issuer || typeof issuer !== "object") return "";
  return Object.entries(issuer)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

export async function probeOriginCertificate({
  address,
  hostname,
  port = 443,
  timeoutMs = 10_000,
}) {
  if (typeof address !== "string" || address.length === 0) {
    throw new Error("origin address is required");
  }
  return await new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: address,
      port,
      servername: hostname,
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
    });
    const timeout = setTimeout(() => {
      socket.destroy(new Error(`origin TLS probe timed out for ${hostname}`));
    }, timeoutMs);
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(
        new Error(`origin TLS probe failed for ${hostname}: ${error.message}`),
      );
    });
    socket.once("secureConnect", () => {
      clearTimeout(timeout);
      const certificate = socket.getPeerCertificate();
      const validFrom = Date.parse(certificate.valid_from);
      const validTo = Date.parse(certificate.valid_to);
      const now = Date.now();
      const result = {
        issuer: issuerName(certificate.issuer),
        subjectAltNames: String(certificate.subjectaltname ?? "")
          .split(",")
          .map((value) => value.trim().replace(/^DNS:/, ""))
          .filter(Boolean),
        validNow:
          Number.isFinite(validFrom) &&
          Number.isFinite(validTo) &&
          validFrom <= now &&
          now < validTo,
        protocol: socket.getProtocol(),
        fingerprint256: certificate.fingerprint256,
      };
      socket.end();
      resolve(result);
    });
  });
}

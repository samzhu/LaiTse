import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const tlsDirectory = resolve(process.cwd(), ".scratch/t01/tls");
const force = process.argv.includes("--force");
const caCertificate = join(tlsDirectory, "local-ca.pem");
const caKey = join(tlsDirectory, "local-ca-key.pem");
const serverCertificate = join(tlsDirectory, "localhost-cert.pem");
const serverKey = join(tlsDirectory, "localhost-key.pem");

if (existsSync(tlsDirectory) && !force) {
  if ([caCertificate, caKey, serverCertificate, serverKey].every(existsSync)) {
    console.log(`Using existing local TLS files in ${tlsDirectory}`);
    process.exit(0);
  }
  throw new Error(`Partial TLS setup exists in ${tlsDirectory}; inspect it or rerun with --force.`);
}

if (force) rmSync(tlsDirectory, { recursive: true, force: true });
mkdirSync(tlsDirectory, { recursive: true, mode: 0o700 });

function runOpenSsl(args) {
  execFileSync("openssl", args, { cwd: tlsDirectory, stdio: "inherit" });
}

runOpenSsl([
  "req", "-x509", "-newkey", "rsa:3072", "-nodes", "-sha256", "-days", "30",
  "-keyout", "local-ca-key.pem", "-out", "local-ca.pem",
  "-subj", "/CN=LaiTse local development CA",
  "-addext", "basicConstraints=critical,CA:TRUE",
  "-addext", "keyUsage=critical,keyCertSign,cRLSign",
]);

runOpenSsl([
  "req", "-newkey", "rsa:2048", "-nodes", "-sha256",
  "-keyout", "localhost-key.pem", "-out", "localhost.csr",
  "-subj", "/CN=localhost",
]);

writeFileSync(join(tlsDirectory, "localhost.ext"), [
  "basicConstraints=critical,CA:FALSE",
  "keyUsage=critical,digitalSignature,keyEncipherment",
  "extendedKeyUsage=serverAuth",
  "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1",
  "",
].join("\n"));

runOpenSsl([
  "x509", "-req", "-in", "localhost.csr", "-CA", "local-ca.pem", "-CAkey", "local-ca-key.pem",
  "-CAcreateserial", "-out", "localhost-cert.pem", "-days", "30", "-sha256", "-extfile", "localhost.ext",
]);

chmodSync(caKey, 0o600);
chmodSync(serverKey, 0o600);
console.log(`Server certificate: ${serverCertificate}`);
console.log(`Server key: ${serverKey}`);
console.log(`CA certificate for an isolated Firefox NSS profile: ${caCertificate}`);
console.log("No system or user trust store was changed.");

const certificateDetails = execFileSync("openssl", ["x509", "-in", serverCertificate, "-noout", "-subject", "-ext", "subjectAltName", "-dates"], { encoding: "utf8" });
writeFileSync(join(tlsDirectory, "certificate-details.txt"), certificateDetails);

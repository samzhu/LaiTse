import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isIP } from "node:net";
import { basename, join, relative, resolve, sep } from "node:path";

enterRepositoryRootForLegacyScript();

const root = repositoryRoot;
const defaultDirectory = resolve(root, ".scratch/t01/tls");
const scratchRoot = resolve(root, ".scratch");

function readOptions(argv) {
  const options = { host: null, outputDirectory: defaultDirectory, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--force") {
      options.force = true;
      continue;
    }
    if (argument === "--host" || argument === "--output-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--host") options.host = value;
      else options.outputDirectory = resolve(root, value);
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  if (options.host && isIP(options.host) === 0) {
    throw new Error("--host must be a literal IPv4 or IPv6 address; host names are not accepted.");
  }
  const outputRelative = relative(scratchRoot, options.outputDirectory);
  if (outputRelative === ".." || outputRelative.startsWith(`..${sep}`) || outputRelative === "" || outputRelative.startsWith(sep)) {
    throw new Error("--output-dir must be a subdirectory of .scratch.");
  }
  return options;
}

const options = readOptions(process.argv.slice(2));
const tlsDirectory = options.outputDirectory;
const caCertificate = join(tlsDirectory, "local-ca.pem");
const caCertificateDer = join(tlsDirectory, "local-ca.cer");
const caKey = join(tlsDirectory, "local-ca-key.pem");
const serverCertificate = join(tlsDirectory, "localhost-cert.pem");
const serverKey = join(tlsDirectory, "localhost-key.pem");
const caExists = existsSync(caCertificate);
const caKeyExists = existsSync(caKey);
const leafExists = existsSync(serverCertificate);
const leafKeyExists = existsSync(serverKey);

if (options.force) {
  rmSync(tlsDirectory, { recursive: true, force: true });
} else if ((caExists !== caKeyExists) || (leafExists !== leafKeyExists)) {
  throw new Error(`Partial TLS setup exists in ${tlsDirectory}; inspect it or rerun with --force.`);
} else if ((leafExists || leafKeyExists) && !(caExists && caKeyExists)) {
  throw new Error(`A server leaf exists without its local CA in ${tlsDirectory}; inspect it or rerun with --force.`);
}

mkdirSync(tlsDirectory, { recursive: true, mode: 0o700 });

function runOpenSsl(args, capture = false) {
  return execFileSync("openssl", args, {
    cwd: tlsDirectory,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
  });
}

function certificateHasIdentity(identity) {
  try {
    runOpenSsl(["x509", "-in", basename(serverCertificate), "-noout", identity.startsWith("IP:") ? "-checkip" : "-checkhost", identity.slice(identity.indexOf(":") + 1)], true);
    return true;
  } catch {
    return false;
  }
}

function createLocalCa() {
  runOpenSsl([
    "req", "-x509", "-newkey", "rsa:3072", "-nodes", "-sha256", "-days", "30",
    "-keyout", basename(caKey), "-out", basename(caCertificate),
    "-subj", "/CN=LaiTse local development CA",
    "-addext", "basicConstraints=critical,CA:TRUE",
    "-addext", "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  chmodSync(caKey, 0o600);
}

function createServerLeaf() {
  runOpenSsl([
    "req", "-newkey", "rsa:2048", "-nodes", "-sha256",
    "-keyout", basename(serverKey), "-out", "localhost.csr",
    "-subj", "/CN=localhost",
  ]);

  const subjectAltNames = ["DNS:localhost", "IP:127.0.0.1", "IP:::1"];
  if (options.host) subjectAltNames.push(`IP:${options.host}`);
  writeFileSync(join(tlsDirectory, "localhost.ext"), [
    "basicConstraints=critical,CA:FALSE",
    "keyUsage=critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage=serverAuth",
    `subjectAltName=${subjectAltNames.join(",")}`,
    "",
  ].join("\n"));

  runOpenSsl([
    "x509", "-req", "-in", "localhost.csr", "-CA", basename(caCertificate), "-CAkey", basename(caKey),
    "-CAcreateserial", "-out", basename(serverCertificate), "-days", "30", "-sha256", "-extfile", "localhost.ext",
  ]);
  chmodSync(serverKey, 0o600);
}

if (!existsSync(caCertificate) || !existsSync(caKey)) createLocalCa();

const requiredIdentities = ["DNS:localhost", "IP:127.0.0.1", "IP:::1", ...(options.host ? [`IP:${options.host}`] : [])];
const leafIsReusable = existsSync(serverCertificate) && existsSync(serverKey) && requiredIdentities.every(certificateHasIdentity);
if (!leafIsReusable) createServerLeaf();

const certificateDetails = runOpenSsl(["x509", "-in", basename(serverCertificate), "-noout", "-subject", "-ext", "subjectAltName", "-dates"], true);
writeFileSync(join(tlsDirectory, "certificate-details.txt"), certificateDetails);
runOpenSsl(["x509", "-in", basename(caCertificate), "-outform", "der", "-out", basename(caCertificateDer)]);

console.log(`${leafIsReusable ? "Using existing" : "Created"} server certificate: ${serverCertificate}`);
console.log(`Server key: ${serverKey}`);
console.log(`Local CA certificate: ${caCertificate}`);
console.log(`DER CA certificate for device import: ${caCertificateDer}`);
if (options.host) console.log(`Certificate SAN includes the LAN IP ${options.host}; localhost SANs remain present.`);
console.log("No system or user trust store was changed.");
console.log("Only the CA certificate is intended for device transfer. Never transfer the CA private key or server private key.");

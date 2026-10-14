// Finds the ROOT certificate that signs a server's TLS chain and prints it in the format the ESP32
// firmware needs (paste it into ROOT_CA in secrets.h). Run:  npm run get:rootca -- <project-ref>.supabase.co
//
// How it works: connects to the host, reads the chain the server sends, then looks up the root that
// issued the top of that chain in Node's built-in list of trusted (Mozilla) root certificates.
// Nothing secret is sent: only a normal TLS handshake is performed.
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i === -1) return null; const v = args[i + 1]; args.splice(i, 2); return v ?? null; };
const extraRootsFile = flag('--extra-roots'); // used by the automated test only
const outFile = flag('--out') ?? 'root-ca.pem';
const host = (args[0] ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const port = Number(args[1] ?? 443);

if (!host) {
  console.error('Usage: npm run get:rootca -- <project-ref>.supabase.co');
  process.exit(1);
}

function fetchChain(hostname, portNumber) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port: portNumber, servername: hostname, rejectUnauthorized: false }, () => {
      const chain = [];
      const seen = new Set();
      let cert = socket.getPeerCertificate(true);
      while (cert && cert.raw && !seen.has(cert.fingerprint256)) {
        seen.add(cert.fingerprint256);
        chain.push(new X509Certificate(cert.raw));
        cert = cert.issuerCertificate;
      }
      socket.end();
      resolve(chain);
    });
    socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('Timed out. Check your internet connection.')); });
    socket.on('error', reject);
  });
}

function splitPem(text) {
  return (text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? []).map((p) => new X509Certificate(p));
}

try {
  const chain = await fetchChain(host, port);
  if (!chain.length) throw new Error('The server did not send a certificate.');
  const top = chain[chain.length - 1];
  const roots = [...tls.rootCertificates.flatMap((p) => splitPem(p)), ...(extraRootsFile ? splitPem(readFileSync(extraRootsFile, 'utf8')) : [])];

  // Print the chain so problems are easy to diagnose.
  const cn = (name) => (/CN=([^\n]+)/.exec(name)?.[1] ?? name.replace(/\n/g, ', '));
  console.log('Certificate chain sent by the server (leaf first):');
  chain.forEach((c, i) => console.log(`  ${i + 1}. ${cn(c.subject)}   (issued by ${cn(c.issuer)}, valid until ${c.validTo})`));
  console.log('');

  const spki = (c) => c.publicKey.export({ type: 'spki', format: 'der' });
  const isSelfSigned = (c) => c.subject === c.issuer && c.verify(c.publicKey);
  let root = null;
  // 1) Prefer a trusted SELF-SIGNED root that has the same name and key as a certificate in the chain.
  //    (Servers often send a cross-signed copy of a modern root; the self-signed copy lasts longer.)
  for (let i = chain.length - 1; i >= 0 && !root; i--) {
    const c = chain[i];
    root = roots.find((r) => r.subject === c.subject && isSelfSigned(r) && spki(r).equals(spki(c))) ?? null;
  }
  // 2) Otherwise use the trusted root that issued the top of the chain.
  if (!root) {
    if (top.subject === top.issuer && top.verify(top.publicKey)) root = top;
    else root = roots.find((r) => r.subject === top.issuer && top.checkIssued(r) && top.verify(r.publicKey)) ?? null;
  }
  if (!root) {
    console.error(`Could not find the root certificate for ${host}.`);
    console.error(`The top certificate in the chain is issued by: ${top.issuer.replace(/\n/g, ', ')}`);
    console.error('This can happen on a network that inspects HTTPS traffic (company firewall). Try from another network.');
    process.exit(2);
  }

  const pem = root.toString().trim() + '\n';
  writeFileSync(outFile, pem);
  console.log(`Server:        ${host}`);
  console.log(`Chain length:  ${chain.length} certificate(s) sent by the server`);
  console.log(`Root subject:  ${root.subject.replace(/\n/g, ', ')}`);
  console.log(`Valid until:   ${root.validTo}`);
  console.log(`\nSaved to ${outFile}. Paste everything between (and including) the BEGIN and END lines into ROOT_CA in secrets.h:\n`);
  console.log(pem);
} catch (e) {
  console.error('Failed: ' + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
}

// Build gate (SRS 4.1 / 18.3): the bundled runtime must be Node.js 22.x.
// Run through Electron: `npx electron scripts/verify-runtime.js` is the strict form;
// under plain node it checks the dev Node version.
const major = Number(process.versions.node.split('.')[0]);
if (major !== 22) {
  console.error(`verify:runtime FAILED: Node ${process.versions.node} is not 22.x`);
  process.exit(1);
}
console.log(`verify:runtime OK: Node ${process.versions.node}`);

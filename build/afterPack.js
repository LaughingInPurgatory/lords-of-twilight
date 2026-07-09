/* ==========================================================================
   electron-builder afterPack hook — ad-hoc code-sign the macOS app.

   We have no paid Apple Developer certificate, so we can't notarize. But an
   *unsigned* (or, worse, a stale-linker-signed-but-modified) arm64 bundle is
   rejected by Gatekeeper as "damaged" once it carries the download quarantine
   flag. Re-sealing the bundle with an ad-hoc signature makes the signature
   valid, so a downloaded copy shows the ordinary "unidentified developer"
   prompt (right-click → Open) instead — and `xattr -cr` then runs it cleanly.
   ========================================================================== */
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename; // "Lords of Twilight"
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  // --deep --force re-seals every nested framework/helper and the outer bundle
  // with an ad-hoc identity ("-"), replacing the invalid linker signature.
  execFileSync('codesign', ['--deep', '--force', '--sign', '-', appPath], { stdio: 'inherit' });
  console.log('  • ad-hoc signed  ' + appPath);
};

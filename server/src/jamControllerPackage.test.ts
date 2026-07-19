import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildControllerReadme,
  buildControllerSetup,
  buildUnixLauncher,
  buildWindowsLauncher,
  buildWindowsPowerShell,
} from './jamControllerPackage';

test('portable Jam controller package needs neither a repository nor npm', () => {
  const setup = buildControllerSetup({
    respawnBaseUrl: 'https://lan.example.test',
    pairingCode: 'ABCD2345',
    accessToken: 'shared-access',
  });
  assert.deepEqual(setup, {
    respawnBaseUrl: 'https://lan.example.test',
    pairingCode: 'ABCD2345',
    accessToken: 'shared-access',
    label: 'LAN-Musikgerät',
  });

  const unix = buildUnixLauncher();
  const windows = `${buildWindowsLauncher()}\n${buildWindowsPowerShell()}`;
  const readme = buildControllerReadme();
  assert.match(unix, /nodejs\.org\/dist\/\$VERSION/);
  assert.match(unix, /SHASUMS256/);
  assert.match(windows, /nodejs\.org\/dist\/\$Version/);
  assert.match(windows, /Get-FileHash/);
  assert.doesNotMatch(`${unix}\n${windows}`, /npm (?:install|run)/);
  assert.match(readme, /ZIP vollständig entpacken/);
  assert.match(readme, /Raspberry Pi\/Linux/);
});

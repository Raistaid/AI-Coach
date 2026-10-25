import test from 'node:test';
import assert from 'node:assert/strict';
import { openCameraStream } from './app/camera.js';

const cameras = [
  { kind: 'videoinput', deviceId: 'front', label: 'Front Camera' },
  { kind: 'videoinput', deviceId: 'wide', label: 'Back Ultra Wide Camera' },
  { kind: 'videoinput', deviceId: 'normal', label: 'Back Wide Camera' },
];
function fakeDevices(defaultRear = 'normal', failLens = false) {
  const calls = [], tracks = [];
  return {
    calls, tracks,
    enumerateDevices: async () => cameras,
    async getUserMedia({ video }) {
      calls.push(video);
      if (failLens && video.deviceId) throw new DOMException('Unavailable lens', 'OverconstrainedError');
      const id = video.deviceId?.exact || (video.facingMode.exact === 'user' ? 'front' : defaultRear);
      const track = { stopped: false, stop() { this.stopped = true; }, getSettings: () => ({ deviceId: id }) };
      tracks.push(track);
      return { getTracks: () => [track], getVideoTracks: () => [track] };
    },
  };
}
test('front camera never switches sides for the wide preference', async () => {
  const devices = fakeDevices();
  const { lens } = await openCameraStream(devices, { facing: 'user', wide: true });
  assert.equal(devices.calls.length, 1);
  assert.deepEqual(devices.calls[0].facingMode, { exact: 'user' });
  assert.equal(lens.active, false);
});
test('rear wide explicitly opens ultra wide and releases previous stream', async () => {
  const devices = fakeDevices();
  const { lens } = await openCameraStream(devices, { facing: 'environment', wide: true });
  assert.deepEqual(devices.calls[1].deviceId, { exact: 'wide' });
  assert.equal(devices.tracks[0].stopped, true);
  assert.equal(lens.active, true);
});
test('switching wide off selects normal lens even if Safari defaults to ultra wide', async () => {
  const devices = fakeDevices('wide');
  const { lens } = await openCameraStream(devices, { facing: 'environment', wide: false });
  assert.deepEqual(devices.calls[1].deviceId, { exact: 'normal' });
  assert.equal(lens.active, false);
});
test('lens failure retries without resolution and restores the same side', async () => {
  const devices = fakeDevices('normal', true);
  const { lens } = await openCameraStream(devices, { facing: 'environment', wide: true });
  assert.deepEqual(devices.calls[2], { deviceId: { exact: 'wide' } });
  assert.deepEqual(devices.calls[3].facingMode, { exact: 'environment' });
  assert.equal(lens.active, false);
});

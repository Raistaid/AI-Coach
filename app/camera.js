// Keep camera direction and optical lens independent of CSS frame fitting.
const ULTRA_WIDE = /ultra[\s-]?wide|сверхширок/i;
const REAR = /back|rear|environment|задн/i;
const STANDARD = /wide|широк/i;

export async function openCameraStream(devices, { facing, wide }) {
  const request = async (selection) => {
    try {
      return await devices.getUserMedia({ audio: false, video: { width: { ideal: 720 }, height: { ideal: 1280 }, ...selection } });
    } catch (error) {
      if (!['OverconstrainedError', 'NotReadableError'].includes(error?.name)) throw error;
      // Drop resolution preferences, never the requested camera or lens.
      return devices.getUserMedia({ audio: false, video: selection });
    }
  };
  // A single-camera device (laptop, test camera) reports no facing mode: an exact request would fail there.
  let media;
  try { media = await request({ facingMode: { exact: facing } }); }
  catch (error) { if (error?.name !== 'OverconstrainedError') throw error; media = await request({ facingMode: { ideal: facing } }); }
  const lens = { ultraId: null, active: false };
  if (facing !== 'environment') return { media, lens };
  let cameras;
  try { cameras = (await devices.enumerateDevices()).filter(d => d.kind === 'videoinput'); }
  catch { return { media, lens }; }
  const ultra = cameras.find(d => ULTRA_WIDE.test(d.label) && !/front|user|передн|фронт/i.test(d.label));
  lens.ultraId = ultra?.deviceId || null;
  const currentId = media.getVideoTracks()[0]?.getSettings?.().deviceId;
  const normal = cameras.find(d => REAR.test(d.label) && STANDARD.test(d.label) && !ULTRA_WIDE.test(d.label))
    || cameras.find(d => REAR.test(d.label) && !ULTRA_WIDE.test(d.label) && !/tele|теле/i.test(d.label));
  const target = wide ? ultra : normal;
  if (target?.deviceId && target.deviceId !== currentId) {
    media.getTracks().forEach(track => track.stop());
    try { media = await request({ deviceId: { exact: target.deviceId } }); }
    catch { media = await request({ facingMode: { exact: facing } }); }
  }
  lens.active = Boolean(lens.ultraId && media.getVideoTracks()[0]?.getSettings?.().deviceId === lens.ultraId);
  return { media, lens };
}

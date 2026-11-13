import * as THREE from "three";

export async function withDeadline(task, ms, message) {
  let timer;
  try {
    return await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

// Load before opening the camera: a missing/corrupt target must not leave a live stream.
export async function loadTarget(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Не удалось загрузить схему (${response.status})`);
  return response.arrayBuffer();
}

// MindAR 1.2.5 uses an async Promise executor in _startAR: errors inside it never
// reject start(). Keep its renderer/video integration, but let initialization reject normally.
export function prepareAR(mindar, Controller, targetBuffer) {
  let disposed = false;
  const startVideo = mindar._startVideo?.bind(mindar);
  if (startVideo) mindar._startVideo = () => {
    const pending = startVideo();
    mindar.video.style.zIndex = "0";
    return pending;
  };
  mindar.renderer.domElement.style && (mindar.renderer.domElement.style.zIndex = "1");
  if (mindar.cssRenderer.domElement.style) mindar.cssRenderer.domElement.style.pointerEvents = "none";
  const resize = mindar.resize.bind(mindar);
  mindar.resize = () => {
    if (!disposed && mindar.controller && mindar.video?.videoWidth) resize();
  };
  mindar._startAR = async () => {
    if (disposed) return;
    const video = mindar.video;
    mindar.controller = new Controller({
      inputWidth: video.videoWidth, inputHeight: video.videoHeight,
      maxTrack: 1, filterMinCF: mindar.filterMinCF, filterBeta: mindar.filterBeta,
      onUpdate: ({ type, targetIndex, worldMatrix }) => {
        if (disposed || type !== "updateMatrix") return;
        for (const anchor of mindar.anchors) {
          if (anchor.targetIndex !== targetIndex) continue;
          const found = worldMatrix !== null;
          anchor.group.visible = found;
          if (found) {
            anchor.group.matrix.fromArray(worldMatrix).multiply(mindar.postMatrixs[targetIndex]);
          }
          if (anchor.visible !== found) {
            anchor.visible = found;
            if (found) anchor.onTargetFound?.(); else anchor.onTargetLost?.();
          }
          anchor.onTargetUpdate?.();
        }
      },
    });
    const { dimensions } = mindar.controller.addImageTargetsFromBuffer(targetBuffer);
    if (!dimensions.length) throw new Error("В файле нет метки стройплощадки");
    mindar.postMatrixs = dimensions.map(([width, height]) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(width / 2, height / 2, 0),
        new THREE.Quaternion(), new THREE.Vector3(width, width, width),
      ));
    mindar.resize();
    await mindar.controller.dummyRun(video);
    if (!disposed) mindar.controller.processVideo(video);
  };
  return () => {
    if (disposed) return;
    disposed = true;
    mindar._closed = true;
    mindar.renderer.setAnimationLoop(null);
    // stop() in upstream throws if initialization failed before controller creation.
    mindar.controller?.stopProcessVideo();
    mindar.controller?.worker?.terminate();
    for (const track of mindar.video?.srcObject?.getTracks() || []) track.stop();
    if (mindar.video) {
      // A pending permission request can resolve after cleanup. Stop that late stream too.
      mindar.video.addEventListener("loadedmetadata", () => {
        for (const track of mindar.video.srcObject?.getTracks() || []) track.stop();
      }, { once: true });
      mindar.video.pause();
      mindar.video.srcObject = null;
      mindar.video.remove();
    }
    mindar.renderer.dispose();
    mindar.renderer.domElement.remove();
    mindar.cssRenderer.domElement.remove();
  };
}

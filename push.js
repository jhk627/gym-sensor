import { add } from "./base.js";

const $ = (id) => document.getElementById(id);
const video = $("pushVideo");
const canvas = $("pushCanvas");
const ctx = canvas.getContext("2d");

let FaceDetectorClass = null;
let FilesetResolverClass = null;
let detector = null;
let stream = null;
let running = false;
let raf = null;

let faceRatio = null;
let upCalibration = null;
let downCalibration = null;
let reps = 0;
let repState = "WAIT_UP";
let candidate = "";
let candidateSince = 0;
let lastVideoTime = -1;

const STABLE_MS = 180;

function setState(text) {
  $("pstate").textContent = text;
}

async function loadMediaPipe() {
  if (FaceDetectorClass && FilesetResolverClass) return;

  setState("AI LOADING");

  try {
    const mp = await import(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs"
    );
    FaceDetectorClass = mp.FaceDetector;
    FilesetResolverClass = mp.FilesetResolver;
  } catch (err) {
    console.error("MediaPipe module load failed:", err);
    throw new Error("얼굴 인식 모듈을 불러오지 못했습니다.");
  }
}

async function ensureDetector() {
  if (detector) return;

  await loadMediaPipe();

  const vision = await FilesetResolverClass.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
  );

  const options = {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
      delegate: "CPU"
    },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.5
  };

  try {
    detector = await FaceDetectorClass.createFromOptions(vision, options);
  } catch (err) {
    console.error("Face detector init failed:", err);
    throw new Error("얼굴 인식 엔진을 시작하지 못했습니다.");
  }

  setState("AI READY");
}

async function openCamera() {
  if (!window.isSecureContext) {
    throw new Error("HTTPS 주소에서 실행해야 카메라를 사용할 수 있습니다.");
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("이 브라우저에서는 카메라 API를 사용할 수 없습니다. iPhone에서는 Safari로 열어주세요.");
  }

  setState("CAMERA...");

  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 }
    }
  });

  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.muted = true;

  await video.play();

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  setState("CAMERA OK");
}

async function start() {
  if (running) return;

  $("pushStart").disabled = true;

  try {
    // Important: open camera first while we are still inside the user's tap event.
    // This is more reliable on iOS Safari than waiting for AI assets first.
    await openCamera();

    running = true;
    $("pushStop").disabled = false;
    $("calUp").disabled = false;
    $("calDown").disabled = false;

    // Camera stays visible even if AI loading fails.
    try {
      await ensureDetector();
    } catch (aiErr) {
      console.error(aiErr);
      setState("AI ERROR");
      alert(
        aiErr.message +
          "\n\n카메라는 열렸지만 얼굴 인식 모듈 로딩에 실패했습니다. Safari에서 새로고침 후 다시 시도해 주세요."
      );
      return;
    }

    loop();
  } catch (err) {
    console.error("Push-up start failed:", err);
    alert(
      (err.message || "카메라를 시작할 수 없습니다.") +
        "\n\niPhone에서는 이 링크를 Safari에서 직접 열고, 설정 → Safari → 카메라 권한도 확인해 주세요."
    );
    stop(false);
  } finally {
    if (!running) $("pushStart").disabled = false;
  }
}

function stop(save = true) {
  running = false;

  if (raf) cancelAnimationFrame(raf);
  raf = null;

  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  $("pushStart").disabled = false;
  $("pushStop").disabled = true;
  $("calUp").disabled = true;
  $("calDown").disabled = true;

  if (save && reps > 0) {
    add({ type: "push", reps });
  }

  setState("READY");
}

function stable(target, now) {
  if (candidate !== target) {
    candidate = target;
    candidateSince = now;
    return false;
  }

  return now - candidateSince >= STABLE_MS;
}

function clearCandidate() {
  candidate = "";
  candidateSince = 0;
}

function updateRepState(ratio, now) {
  if (
    upCalibration == null ||
    downCalibration == null ||
    downCalibration <= upCalibration * 1.05
  ) {
    setState("CALIBRATE");
    return;
  }

  const span = downCalibration - upCalibration;
  const upThreshold = upCalibration + span * 0.38;
  const downThreshold = upCalibration + span * 0.62;

  if (repState === "WAIT_UP") {
    if (ratio <= upThreshold && stable("UP_READY", now)) {
      repState = "UP";
      clearCandidate();
      setState("UP");
    } else if (ratio > upThreshold) {
      clearCandidate();
    }
    return;
  }

  if (repState === "UP") {
    if (ratio >= downThreshold && stable("DOWN", now)) {
      repState = "DOWN";
      clearCandidate();
      setState("DOWN");
    } else if (ratio < downThreshold) {
      clearCandidate();
    }
    return;
  }

  if (repState === "DOWN") {
    if (ratio <= upThreshold && stable("REP_UP", now)) {
      repState = "UP";
      clearCandidate();
      reps += 1;
      $("reps").textContent = String(reps);
      setState("UP");

      if ("speechSynthesis" in window) {
        try {
          speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(String(reps));
          utterance.lang = "ko-KR";
          utterance.rate = 1.15;
          speechSynthesis.speak(utterance);
        } catch {}
      }
    } else if (ratio > upThreshold) {
      clearCandidate();
    }
  }
}

function drawFace(box) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.strokeStyle = "#68e290";
  ctx.lineWidth = Math.max(3, canvas.width * 0.004);
  ctx.strokeRect(box.originX, box.originY, box.width, box.height);
  ctx.restore();
}

function loop() {
  if (!running || !detector) return;

  raf = requestAnimationFrame(loop);

  if (video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;

  lastVideoTime = video.currentTime;

  let result;
  try {
    result = detector.detectForVideo(video, performance.now());
  } catch (err) {
    console.error("Face detection frame error:", err);
    return;
  }

  const detection = result?.detections?.[0];

  if (!detection?.boundingBox) {
    faceRatio = null;
    $("ratio").textContent = "FACE --%";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    clearCandidate();
    setState(
      upCalibration != null && downCalibration != null
        ? repState === "DOWN"
          ? "DOWN"
          : "FACE?"
        : "FACE?"
    );
    return;
  }

  const box = detection.boundingBox;
  drawFace(box);

  faceRatio =
    (box.width * box.height) / (canvas.width * canvas.height);

  $("ratio").textContent = `FACE ${(faceRatio * 100).toFixed(1)}%`;

  updateRepState(faceRatio, performance.now());
}

async function calibrate(which) {
  if (!running) {
    alert("먼저 START를 눌러 카메라를 시작하세요.");
    return;
  }

  if (faceRatio == null) {
    alert("얼굴이 카메라에 보이게 해주세요.");
    return;
  }

  const samples = [];
  const startedAt = performance.now();
  const button = which === "up" ? $("calUp") : $("calDown");

  button.disabled = true;
  setState(which === "up" ? "HOLD UP" : "HOLD DOWN");

  while (performance.now() - startedAt < 900) {
    if (faceRatio != null) samples.push(faceRatio);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  button.disabled = false;

  if (samples.length < 5) {
    alert("얼굴을 안정적으로 인식하지 못했습니다. 다시 시도하세요.");
    return;
  }

  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];

  if (which === "up") {
    upCalibration = median;
    $("upVal").textContent = `${(median * 100).toFixed(1)}%`;
  } else {
    downCalibration = median;
    $("downVal").textContent = `${(median * 100).toFixed(1)}%`;
  }

  repState = "WAIT_UP";
  clearCandidate();

  if (
    upCalibration != null &&
    downCalibration != null &&
    downCalibration <= upCalibration * 1.05
  ) {
    setState("RECALIBRATE");
    alert(
      "UP과 DOWN의 얼굴 거리 차이가 너무 작습니다. DOWN에서 얼굴이 카메라에 더 가까워지도록 폰 위치를 조정해 주세요."
    );
    return;
  }

  setState(
    upCalibration != null && downCalibration != null
      ? "READY"
      : "CALIBRATE"
  );
}

$("pushStart").addEventListener("click", start);
$("pushStop").addEventListener("click", () => stop(true));
$("pushReset").addEventListener("click", () => {
  reps = 0;
  repState = "WAIT_UP";
  clearCandidate();
  $("reps").textContent = "0";
  setState("READY");
});

$("calUp").addEventListener("click", () => calibrate("up"));
$("calDown").addEventListener("click", () => calibrate("down"));

window.addEventListener("pagehide", () => {
  if (running) stop(false);
});

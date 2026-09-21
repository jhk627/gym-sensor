import { FaceDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs";
import { add } from "./base.js";

const $ = (id) => document.getElementById(id);
const video = $("pushVideo");
const canvas = $("pushCanvas");
const ctx = canvas.getContext("2d");

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

async function ensureDetector() {
  if (detector) return;

  $("pstate").textContent = "AI LOADING";

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
  );

  const options = {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.55
  };

  try {
    detector = await FaceDetector.createFromOptions(vision, options);
  } catch {
    options.baseOptions.delegate = "CPU";
    detector = await FaceDetector.createFromOptions(vision, options);
  }

  $("pstate").textContent = "AI READY";
}

async function start() {
  if (running) return;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 960 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      }
    });

    video.srcObject = stream;
    await video.play();
    await ensureDetector();

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    running = true;
    $("pushStart").disabled = true;
    $("pushStop").disabled = false;
    $("calUp").disabled = false;
    $("calDown").disabled = false;

    loop();
  } catch (err) {
    console.error(err);
    alert("카메라를 시작할 수 없습니다. Safari/Chrome의 카메라 권한을 확인하세요.");
    stop(false);
  }
}

function stop(save = true) {
  running = false;

  if (raf) cancelAnimationFrame(raf);
  if (stream) stream.getTracks().forEach((track) => track.stop());

  stream = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  $("pushStart").disabled = false;
  $("pushStop").disabled = true;
  $("calUp").disabled = true;
  $("calDown").disabled = true;

  if (save && reps > 0) {
    add({ type: "push", reps });
  }
}

function setState(text) {
  $("pstate").textContent = text;
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
  if (!running) return;

  raf = requestAnimationFrame(loop);

  if (!detector || video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;

  lastVideoTime = video.currentTime;

  let result;
  try {
    result = detector.detectForVideo(video, performance.now());
  } catch (err) {
    console.error(err);
    return;
  }

  const detection = result?.detections?.[0];

  if (!detection?.boundingBox) {
    faceRatio = null;
    $("ratio").textContent = "FACE --%";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    clearCandidate();
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
  if (faceRatio == null) {
    alert("얼굴이 카메라에 보이게 해주세요.");
    return;
  }

  const samples = [];
  const startedAt = performance.now();
  const button = which === "up" ? $("calUp") : $("calDown");

  button.disabled = true;

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
    alert("UP과 DOWN의 얼굴 거리 차이가 너무 작습니다. 폰 위치를 조정하고 다시 보정하세요.");
    return;
  }

  setState(
    upCalibration != null && downCalibration != null
      ? "READY"
      : "CALIBRATE"
  );
}

$("pushStart").onclick = start;
$("pushStop").onclick = () => stop(true);
$("pushReset").onclick = () => {
  reps = 0;
  repState = "WAIT_UP";
  clearCandidate();
  $("reps").textContent = "0";
  setState("READY");
};

$("calUp").onclick = () => calibrate("up");
$("calDown").onclick = () => calibrate("down");

window.addEventListener("pagehide", () => {
  if (running) stop(false);
});

import { add } from "./base.js";

const $ = (id) => document.getElementById(id);
const video = $("pushVideo");
const canvas = $("pushCanvas");
const ctx = canvas.getContext("2d");

let stream = null;
let running = false;
let detector = null;
let raf = null;
let busy = false;
let lastProcess = 0;

let faceWidth = null;
let smoothWidth = null;
let recentWidths = [];

let upCalibration = null;
let downCalibration = null;

let reps = 0;
let repState = "WAIT_UP";
let candidate = "";
let candidateHits = 0;

const PROCESS_MS = 90;
const REQUIRED_HITS = 2;
const SMOOTH_WINDOW = 5;
const MIN_GAP = 0.035;

function setState(text) {
  $("pstate").textContent = text;
}

function clearCandidate() {
  candidate = "";
  candidateHits = 0;
}

function hit(target) {
  if (candidate !== target) {
    candidate = target;
    candidateHits = 1;
    return false;
  }
  candidateHits += 1;
  return candidateHits >= REQUIRED_HITS;
}

function median(values) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

function calibrationReady() {
  return (
    upCalibration != null &&
    downCalibration != null &&
    Math.abs(downCalibration - upCalibration) >= MIN_GAP
  );
}

function updateDebug() {
  const cur = smoothWidth == null ? "--" : (smoothWidth * 100).toFixed(1) + "%";
  const up = upCalibration == null ? "--" : (upCalibration * 100).toFixed(1) + "%";
  const down = downCalibration == null ? "--" : (downCalibration * 100).toFixed(1) + "%";

  let thresholdText = "";
  if (calibrationReady()) {
    const delta = downCalibration - upCalibration;
    const upThreshold = upCalibration + delta * 0.38;
    const downThreshold = upCalibration + delta * 0.62;
    thresholdText =
      " · 판정 " +
      (upThreshold * 100).toFixed(1) +
      "% / " +
      (downThreshold * 100).toFixed(1) +
      "%";
  }

  $("sensorDebug").textContent =
    "현재 얼굴 " + cur + " · UP " + up + " · DOWN " + down + thresholdText;
}

function drawBox(box) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const x = (box.xCenter - box.width / 2) * canvas.width;
  const y = (box.yCenter - box.height / 2) * canvas.height;
  const w = box.width * canvas.width;
  const h = box.height * canvas.height;

  ctx.save();
  ctx.strokeStyle = "#68e290";
  ctx.lineWidth = Math.max(3, canvas.width * 0.006);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function updateState(value) {
  updateDebug();

  if (!calibrationReady()) {
    setState("CALIBRATE");
    return;
  }

  const delta = downCalibration - upCalibration;
  const upThreshold = upCalibration + delta * 0.38;
  const downThreshold = upCalibration + delta * 0.62;
  const downIsLarger = delta > 0;

  const isUp = downIsLarger
    ? value <= upThreshold
    : value >= upThreshold;

  const isDown = downIsLarger
    ? value >= downThreshold
    : value <= downThreshold;

  if (repState === "WAIT_UP") {
    if (isUp) {
      if (hit("UP_READY")) {
        repState = "UP";
        clearCandidate();
        setState("UP");
      }
    } else {
      clearCandidate();
      setState("MOVE TO UP");
    }
    return;
  }

  if (repState === "UP") {
    if (isDown) {
      if (hit("DOWN")) {
        repState = "DOWN";
        clearCandidate();
        setState("DOWN");
      }
    } else {
      clearCandidate();
      setState("UP");
    }
    return;
  }

  if (repState === "DOWN") {
    if (isUp) {
      if (hit("REP_UP")) {
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
      }
    } else {
      clearCandidate();
      setState("DOWN");
    }
  }
}

function onResults(results) {
  if (!running) return;

  const detections = results?.detections || [];

  if (!detections.length) {
    faceWidth = null;
    $("ratio").textContent = "FACE --%";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setState("FACE?");
    updateDebug();
    return;
  }

  // Choose the largest face in case another face appears in the background.
  const detection = detections.reduce((best, cur) => {
    const b = cur.boundingBox;
    const bb = best?.boundingBox;
    if (!best) return cur;
    return b.width * b.height > bb.width * bb.height ? cur : best;
  }, null);

  const box = detection.boundingBox;
  drawBox(box);

  faceWidth = box.width;

  recentWidths.push(faceWidth);
  if (recentWidths.length > SMOOTH_WINDOW) recentWidths.shift();
  smoothWidth = median(recentWidths);

  $("ratio").textContent = "FACE " + (smoothWidth * 100).toFixed(1) + "%";

  updateState(smoothWidth);
}

async function ensureDetector() {
  if (detector) return;

  if (!window.FaceDetection) {
    throw new Error("얼굴 검출 라이브러리를 불러오지 못했습니다.");
  }

  setState("AI LOADING");

  detector = new window.FaceDetection({
    locateFile: (file) =>
      "https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4/" + file
  });

  detector.setOptions({
    model: "short",
    minDetectionConfidence: 0.35
  });

  detector.onResults(onResults);

  // First send initializes WASM/model assets.
  await detector.send({ image: video });

  setState("FACE READY");
}

async function loop(now) {
  if (!running) return;
  raf = requestAnimationFrame(loop);

  if (busy || now - lastProcess < PROCESS_MS || video.readyState < 2) return;

  lastProcess = now;
  busy = true;

  try {
    await detector.send({ image: video });
  } catch (err) {
    console.error("Face detection frame failed:", err);
  } finally {
    busy = false;
  }
}

async function start() {
  if (running) return;

  $("pushStart").disabled = true;

  try {
    if (!window.isSecureContext) {
      throw new Error("HTTPS 주소에서 실행해야 카메라를 사용할 수 있습니다.");
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("이 브라우저에서는 카메라 API를 사용할 수 없습니다.");
    }

    setState("CAMERA...");

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 }
      }
    });

    video.srcObject = stream;
    video.setAttribute("playsinline", "");
    video.muted = true;
    await video.play();

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    running = true;
    faceWidth = null;
    smoothWidth = null;
    recentWidths = [];
    clearCandidate();

    $("pushStop").disabled = false;
    $("calUp").disabled = false;
    $("calDown").disabled = false;

    await ensureDetector();

    setState(calibrationReady() ? "MOVE TO UP" : "CALIBRATE");
    updateDebug();

    raf = requestAnimationFrame(loop);
  } catch (err) {
    console.error("Push-up start failed:", err);

    alert(
      (err.message || "카메라 또는 얼굴 검출을 시작할 수 없습니다.") +
        "\n\nSafari에서 페이지를 새로고침한 뒤 다시 시도해 주세요."
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
  busy = false;

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }

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

async function calibrate(which) {
  if (!running) {
    alert("먼저 START를 눌러 카메라를 시작하세요.");
    return;
  }

  if (smoothWidth == null) {
    alert("얼굴에 초록색 박스가 잡히는지 확인하세요.");
    return;
  }

  const button = which === "up" ? $("calUp") : $("calDown");
  button.disabled = true;

  setState(which === "up" ? "HOLD UP" : "HOLD DOWN");

  const samples = [];
  const startTime = performance.now();

  while (performance.now() - startTime < 1200) {
    if (smoothWidth != null) samples.push(smoothWidth);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  button.disabled = false;

  if (samples.length < 6) {
    alert("얼굴을 안정적으로 검출하지 못했습니다. 다시 시도하세요.");
    return;
  }

  const value = median(samples);

  if (which === "up") {
    upCalibration = value;
    $("upVal").textContent = (value * 100).toFixed(1) + "%";
  } else {
    downCalibration = value;
    $("downVal").textContent = (value * 100).toFixed(1) + "%";
  }

  repState = "WAIT_UP";
  clearCandidate();
  updateDebug();

  if (
    upCalibration != null &&
    downCalibration != null &&
    Math.abs(downCalibration - upCalibration) < MIN_GAP
  ) {
    setState("RECALIBRATE");
    alert(
      "UP과 DOWN 얼굴 크기 차이가 너무 작습니다.\n\n폰을 얼굴 앞쪽에 두고 DOWN에서 얼굴이 확실히 더 크게 보이도록 다시 보정해 주세요."
    );
    return;
  }

  setState(calibrationReady() ? "MOVE TO UP" : "CALIBRATE");
}

$("pushStart").addEventListener("click", start);
$("pushStop").addEventListener("click", () => stop(true));

$("pushReset").addEventListener("click", () => {
  reps = 0;
  repState = "WAIT_UP";
  clearCandidate();
  $("reps").textContent = "0";
  setState(calibrationReady() ? "MOVE TO UP" : "READY");
});

$("calUp").addEventListener("click", () => calibrate("up"));
$("calDown").addEventListener("click", () => calibrate("down"));

window.addEventListener("pagehide", () => {
  if (running) stop(false);
});

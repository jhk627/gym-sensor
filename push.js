import { add } from "./base.js";

const $ = (id) => document.getElementById(id);
const video = $("pushVideo");
const canvas = $("pushCanvas");
const ctx = canvas.getContext("2d");

let stream = null;
let running = false;
let trackerTask = null;

let rawMetric = null;
let metric = null;
let upCalibration = null;
let downCalibration = null;
let reps = 0;
let repState = "WAIT_UP";

let candidate = "";
let candidateHits = 0;

const REQUIRED_HITS = 2;
const SMOOTH_ALPHA = 0.38;
const MIN_CALIBRATION_GAP = 0.025;

function setState(text) {
  $("pstate").textContent = text;
}

function debugText() {
  const current = metric == null ? "--" : (metric * 100).toFixed(1) + "%";
  const up = upCalibration == null ? "--" : (upCalibration * 100).toFixed(1) + "%";
  const down = downCalibration == null ? "--" : (downCalibration * 100).toFixed(1) + "%";

  let extra = "";
  if (upCalibration != null && downCalibration != null) {
    const delta = downCalibration - upCalibration;
    const upThreshold = upCalibration + delta * 0.35;
    const downThreshold = upCalibration + delta * 0.65;
    extra =
      " · 판정선 " +
      (upThreshold * 100).toFixed(1) +
      "% / " +
      (downThreshold * 100).toFixed(1) +
      "%";
  }

  $("sensorDebug").textContent =
    "현재값 " + current + " · UP " + up + " · DOWN " + down + extra;
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

function clearCandidate() {
  candidate = "";
  candidateHits = 0;
}

function calibrationReady() {
  return (
    upCalibration != null &&
    downCalibration != null &&
    Math.abs(downCalibration - upCalibration) >= MIN_CALIBRATION_GAP
  );
}

function updateRepState(value) {
  debugText();

  if (!calibrationReady()) {
    setState("CALIBRATE");
    return;
  }

  const delta = downCalibration - upCalibration;
  const upThreshold = upCalibration + delta * 0.35;
  const downThreshold = upCalibration + delta * 0.65;

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

function drawFace(rect) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.strokeStyle = "#68e290";
  ctx.lineWidth = Math.max(3, canvas.width * 0.004);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function handleFaces(event) {
  if (!running) return;

  const faces = event.data || [];

  if (!faces.length) {
    $("ratio").textContent = "FACE --%";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setState(repState === "DOWN" ? "DOWN · FACE?" : "FACE?");
    return;
  }

  const face = faces.reduce((best, cur) => {
    if (!best) return cur;
    return cur.width * cur.height > best.width * best.height ? cur : best;
  }, null);

  drawFace(face);

  // Width ratio is less sensitive to head pitch than face-area ratio.
  rawMetric = face.width / Math.max(1, canvas.width);
  metric =
    metric == null
      ? rawMetric
      : SMOOTH_ALPHA * rawMetric + (1 - SMOOTH_ALPHA) * metric;

  $("ratio").textContent = "FACE " + (metric * 100).toFixed(1) + "%";

  updateRepState(metric);
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

    if (!window.tracking || !window.tracking.ObjectTracker) {
      throw new Error("얼굴 인식 라이브러리를 불러오지 못했습니다.");
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

    const tracker = new window.tracking.ObjectTracker("face");
    tracker.setInitialScale(3);
    tracker.setStepSize(1.7);
    tracker.setEdgesDensity(0.08);
    tracker.on("track", handleFaces);

    trackerTask = window.tracking.track(video, tracker, {
      camera: false
    });

    running = true;
    rawMetric = null;
    metric = null;
    clearCandidate();

    $("pushStop").disabled = false;
    $("calUp").disabled = false;
    $("calDown").disabled = false;

    setState("FACE READY");
    debugText();
  } catch (err) {
    console.error("Push-up start failed:", err);
    alert(
      (err.message || "카메라를 시작할 수 없습니다.") +
        "\n\nSafari에서 페이지를 새로고침한 뒤 다시 시도해 주세요."
    );
    stop(false);
  } finally {
    if (!running) $("pushStart").disabled = false;
  }
}

function stop(save = true) {
  running = false;

  if (trackerTask?.stop) {
    try {
      trackerTask.stop();
    } catch {}
  }
  trackerTask = null;

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

  if (metric == null) {
    alert("얼굴이 카메라에 보이고 FACE 값이 표시되는지 확인하세요.");
    return;
  }

  const samples = [];
  const startedAt = performance.now();
  const button = which === "up" ? $("calUp") : $("calDown");

  button.disabled = true;
  setState(which === "up" ? "HOLD UP" : "HOLD DOWN");

  while (performance.now() - startedAt < 1100) {
    if (metric != null) samples.push(metric);
    await new Promise((resolve) => setTimeout(resolve, 70));
  }

  button.disabled = false;

  if (samples.length < 6) {
    alert("얼굴을 안정적으로 인식하지 못했습니다. 다시 시도하세요.");
    return;
  }

  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];

  if (which === "up") {
    upCalibration = median;
    $("upVal").textContent = (median * 100).toFixed(1) + "%";
  } else {
    downCalibration = median;
    $("downVal").textContent = (median * 100).toFixed(1) + "%";
  }

  repState = "WAIT_UP";
  clearCandidate();
  debugText();

  if (
    upCalibration != null &&
    downCalibration != null &&
    Math.abs(downCalibration - upCalibration) < MIN_CALIBRATION_GAP
  ) {
    setState("RECALIBRATE");
    alert(
      "UP과 DOWN 값의 차이가 너무 작습니다. 폰을 얼굴 아래쪽에 더 가깝게 두고 다시 보정해 주세요.\n\n현재 UP " +
        (upCalibration * 100).toFixed(1) +
        "% / DOWN " +
        (downCalibration * 100).toFixed(1) +
        "%"
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

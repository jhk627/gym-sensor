import { add } from "./base.js";

const $ = (id) => document.getElementById(id);
const video = $("pushVideo");
const canvas = $("pushCanvas");
const ctx = canvas.getContext("2d");

let stream = null;
let running = false;
let trackerTask = null;
let faceRatio = null;
let upCalibration = null;
let downCalibration = null;
let reps = 0;
let repState = "WAIT_UP";
let candidate = "";
let candidateSince = 0;

const STABLE_MS = 180;

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
    faceRatio = null;
    $("ratio").textContent = "FACE --%";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    clearCandidate();
    if (upCalibration == null || downCalibration == null) {
      setState("FACE?");
    }
    return;
  }

  // Use the largest detected face.
  const face = faces.reduce((best, cur) => {
    if (!best) return cur;
    return cur.width * cur.height > best.width * best.height ? cur : best;
  }, null);

  drawFace(face);

  faceRatio =
    (face.width * face.height) /
    Math.max(1, canvas.width * canvas.height);

  $("ratio").textContent = `FACE ${(faceRatio * 100).toFixed(1)}%`;

  updateRepState(faceRatio, performance.now());
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
    tracker.setInitialScale(4);
    tracker.setStepSize(2);
    tracker.setEdgesDensity(0.1);
    tracker.on("track", handleFaces);

    trackerTask = window.tracking.track(video, tracker, {
      camera: false
    });

    running = true;

    $("pushStop").disabled = false;
    $("calUp").disabled = false;
    $("calDown").disabled = false;

    setState("FACE READY");
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

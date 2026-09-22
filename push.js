import { add } from "./base.js";

const $ = (id) => document.getElementById(id);
const video = $("pushVideo");
const canvas = $("pushCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

let stream = null;
let running = false;
let raf = null;
let lastProcess = 0;

let upTemplate = null;
let downTemplate = null;
let currentDescriptor = null;

let reps = 0;
let repState = "WAIT_UP";
let candidate = "";
let candidateHits = 0;

let smoothScore = 0;

const W = 48;
const H = 36;
const PROCESS_MS = 110;
const REQUIRED_HITS = 2;
const HYSTERESIS = 0.12;

const sampleCanvas = document.createElement("canvas");
sampleCanvas.width = W;
sampleCanvas.height = H;
const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

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

function descriptorFromVideo() {
  if (video.readyState < 2) return null;

  sampleCtx.drawImage(video, 0, 0, W, H);
  const data = sampleCtx.getImageData(0, 0, W, H).data;
  const values = new Float32Array(W * H);

  let mean = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    // Luminance.
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    values[j] = y;
    mean += y;
  }
  mean /= values.length;

  let variance = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - mean;
    variance += d * d;
  }

  const std = Math.sqrt(variance / values.length) || 1;

  // Brightness-normalized descriptor. This makes it less sensitive to exposure changes.
  for (let i = 0; i < values.length; i++) {
    values[i] = (values[i] - mean) / std;
  }

  return values;
}

function averageDescriptors(list) {
  if (!list.length) return null;
  const out = new Float32Array(list[0].length);
  for (const arr of list) {
    for (let i = 0; i < out.length; i++) out[i] += arr[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= list.length;
  return out;
}

function distance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / a.length;
}

function templateSeparation() {
  if (!upTemplate || !downTemplate) return 0;
  return distance(upTemplate, downTemplate);
}

function classify(desc) {
  if (!upTemplate || !downTemplate) return null;

  const dUp = distance(desc, upTemplate);
  const dDown = distance(desc, downTemplate);
  const denom = dUp + dDown || 1;

  // -1 means UP-like, +1 means DOWN-like.
  const rawScore = (dUp - dDown) / denom;
  smoothScore = 0.38 * rawScore + 0.62 * smoothScore;

  const upSimilarity = Math.max(0, Math.min(100, Math.round((1 - dUp / Math.max(templateSeparation(), 0.001)) * 100)));
  const downSimilarity = Math.max(0, Math.min(100, Math.round((1 - dDown / Math.max(templateSeparation(), 0.001)) * 100)));

  $("sensorDebug").textContent =
    "UP 유사도 " + upSimilarity + "% · DOWN 유사도 " + downSimilarity +
    "% · SCORE " + smoothScore.toFixed(2);

  $("ratio").textContent = "POSE " + smoothScore.toFixed(2);

  return smoothScore;
}

function updateRep(score) {
  if (!upTemplate || !downTemplate) {
    setState("CALIBRATE");
    return;
  }

  const isUp = score <= -HYSTERESIS;
  const isDown = score >= HYSTERESIS;

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

function drawGuide() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const w = canvas.width * 0.72;
  const h = canvas.height * 0.72;
  const x = (canvas.width - w) / 2;
  const y = (canvas.height - h) / 2;

  ctx.save();
  ctx.strokeStyle = "rgba(104,226,144,.85)";
  ctx.lineWidth = Math.max(2, canvas.width * 0.004);
  ctx.setLineDash([12, 10]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function loop(now) {
  if (!running) return;
  raf = requestAnimationFrame(loop);

  drawGuide();

  if (now - lastProcess < PROCESS_MS) return;
  lastProcess = now;

  const desc = descriptorFromVideo();
  if (!desc) return;

  currentDescriptor = desc;

  if (!upTemplate || !downTemplate) {
    $("ratio").textContent = "POSE READY";
    setState("CALIBRATE");
    return;
  }

  const score = classify(desc);
  if (score != null) updateRep(score);
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
        height: { ideal: 480 }
      }
    });

    video.srcObject = stream;
    video.setAttribute("playsinline", "");
    video.muted = true;
    await video.play();

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    running = true;
    smoothScore = 0;
    clearCandidate();

    $("pushStop").disabled = false;
    $("calUp").disabled = false;
    $("calDown").disabled = false;

    setState(upTemplate && downTemplate ? "MOVE TO UP" : "CALIBRATE");
    $("sensorDebug").textContent = "얼굴 인식 없이 전체 영상 패턴을 비교합니다.";

    raf = requestAnimationFrame(loop);
  } catch (err) {
    console.error("Push-up start failed:", err);
    alert(
      (err.message || "카메라를 시작할 수 없습니다.") +
      "\n\nSafari에서 카메라 권한을 확인해 주세요."
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

async function captureTemplate(which) {
  if (!running) {
    alert("먼저 START를 눌러 카메라를 시작하세요.");
    return;
  }

  const button = which === "up" ? $("calUp") : $("calDown");
  button.disabled = true;

  setState(which === "up" ? "HOLD UP" : "HOLD DOWN");

  const frames = [];
  const startedAt = performance.now();

  while (performance.now() - startedAt < 1200) {
    const desc = descriptorFromVideo();
    if (desc) frames.push(desc);
    await new Promise((resolve) => setTimeout(resolve, 90));
  }

  button.disabled = false;

  if (frames.length < 6) {
    alert("보정 영상을 충분히 얻지 못했습니다. 다시 시도하세요.");
    return;
  }

  const template = averageDescriptors(frames);

  if (which === "up") {
    upTemplate = template;
    $("upVal").textContent = "SAVED";
  } else {
    downTemplate = template;
    $("downVal").textContent = "SAVED";
  }

  repState = "WAIT_UP";
  smoothScore = 0;
  clearCandidate();

  if (upTemplate && downTemplate) {
    const sep = templateSeparation();

    if (sep < 0.20) {
      setState("RECALIBRATE");
      $("sensorDebug").textContent =
        "UP/DOWN 영상 차이가 작습니다: " + sep.toFixed(2);
      alert(
        "UP과 DOWN 영상 차이가 너무 작습니다.\n\n폰을 얼굴/상체가 더 크게 보이는 위치로 옮기고 다시 보정해 주세요."
      );
      return;
    }

    $("sensorDebug").textContent =
      "보정 완료 · UP/DOWN 차이 " + sep.toFixed(2);
    setState("MOVE TO UP");
  } else {
    $("sensorDebug").textContent =
      which === "up"
        ? "UP 저장 완료 · 이제 DOWN을 보정하세요."
        : "DOWN 저장 완료 · 이제 UP을 보정하세요.";
    setState("CALIBRATE");
  }
}

$("pushStart").addEventListener("click", start);
$("pushStop").addEventListener("click", () => stop(true));

$("pushReset").addEventListener("click", () => {
  reps = 0;
  repState = "WAIT_UP";
  smoothScore = 0;
  clearCandidate();
  $("reps").textContent = "0";
  setState(upTemplate && downTemplate ? "MOVE TO UP" : "READY");
});

$("calUp").addEventListener("click", () => captureTemplate("up"));
$("calDown").addEventListener("click", () => captureTemplate("down"));

window.addEventListener("pagehide", () => {
  if (running) stop(false);
});

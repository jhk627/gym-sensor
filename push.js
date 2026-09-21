import{FaceDetector,FilesetResolver}from'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs';import{add}from'./base.js';const $=id=>document.getElementById(id),v=$('pushVideo'),c=$('pushCanvas'),x=c.getContext('2d');let fd,s,run=0,raf,ratio,up,down,reps=0,state='WAIT',cand='',since=0,last=-1;async function detector(){if(fd)return;let vis=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm'),o={baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',delegate:'GPU'},runningMode:'VIDEO',minDetectionConfidence:.55};try{fd=await FaceDetector.createFromOptions(vis,o)}catch{o.baseOptions.delegate='CPU';fd=await FaceDetector.createFromOptions(vis,o)}}async function start(){try{s=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'user'},width:{ideal:960},height:{ideal:720}},audio:false});v.srcObject=s;await v.play();await detector();c.width=v.videoWidth;c.height=v.videoHeight;run=1;$('pushStart').disabled=1;$('pushStop').disabled=0;$('calUp').disabled=0;$('calDow').disabled=0;loop()}catch{alert('ë.m:êe:ço:­£;eg;'a;fe{'n;ef;!.;&¥	Ê__Y[˜İ[ÛˆİÜ
Ø]™OLJ^Ü[LÚYŠ˜YŠXØ[˜Ù[[š[X][Û‘œ˜[YJ˜YŠNÚYŠÊ\Ë™Ù]˜XÚÜÊ
K™›Ü‘XXÚ
OœİÜ

JNÉ
	Ü\Úİ\	ÊK™\ØX›YLÉ
	Ü\ÚİÜ	ÊK™\ØX›YLNÉ
	ØØ[\	ÊK™\ØX›YI
	ØØ[İÉÊK™\ØX›YLNÚYŠØ]™I‰œ™\ÊXY
İ\N‰Ü\Ú	Ë™\ßJ_Y[˜İ[ÛˆİX›JŠ^ÚYŠØ[™OO]
^ØØ[™]ÜÚ[˜ÙO[Ü™]\›ˆ\™]\›ˆ‹\Ú[˜ÙOŒNY[˜İ[Ûˆİ

^É
	Üİ]IÊK^ÛÛ[]Y[˜İ[Ûˆ\]J‹Š^ÚYŠ\O[[İÛO[[İÛ]\
ŒKŒJ\™]\›ˆİ
	ĞĞSP”UIÊNÛ]YİÛ‹]\O]\
Ù
‹ŒÎ]\
Ù
‹ŒÚYŠİ]OOOIÕĞRU	Ê^ÚYŠUI‰œİX›J	ÕIËŠJ^Üİ]OIÕT	ÎØØ[™IÉÎÜİ
	ÕT	Ê__Y[ÙHYŠİ]OOOIÕT	Ê^ÚYŠQ	‰œİX›J	Ñ	ËŠJ^Üİ]OIÑÕÓ‰ÎØØ[™IÉÎÜİ
	ÑÕÓ‰Ê__Y[ÙHYŠİ]OOOIÑÕÓ‰Ê^ÚYŠUI‰œİX›J	Ô‰ËŠJ^Üİ]OIÕT	ÎØØ[™IÉÎÜ™\ÊÊÎÉ
	Ü™\ÉÊK^ÛÛ[\™\ÎÜİ
	ÕT	ÊNİ^ÜÜYXÚŞ[\Ú\Ë˜Ø[˜Ù[

NÛ]O[™]ÈÜYXÚŞ[\Ú\Õ]\˜[˜ÙJİš[™Ê™\ÊJNÜK›[™ÏIÚÛËRÔ‰ÎÜÜYXÚŞ[\Ú\ËœÜXZÊJ_XØ]Úß___Y[˜İ[ÛˆÛÜ

^ÚYŠ\[Š\™]\›Ü˜Y\™\]Y\İ[š[X][Û‘œ˜[YJÛÜ
NÚYŠY™‹œ™XYTİ]OŸ‹˜İ\œ™[[YOOO[\İ
\™]\›Û\İ]‹˜İ\œ™[[YNÛ]OY™™]Xİ›Ü•šY[Ê‹\™›Ü›X[˜ÙK››İÊ
JK™]Xİ[ÛœÏË–ÌNŞ˜ÛX\”™Xİ
ËÚYËšZYÚ
NÚYŠ\J^Ü˜][Ï[[É
	Ü˜][ÉÊK^ÛÛ[IÑPÑHKIIÎÜ™]\›Ÿ[]\K˜›İ[™[™Ğ›ŞŞœİ›ÚÙTİ[OIÈÍLL	ÎŞ›[™UÚYMŞœİ›ÚÙT™Xİ
‹›ÜšYÚ[–‹›ÜšYÚ[–K‹ÚY‹šZYÚ
NÜ˜][ÏX‹ÚY
˜‹šZYÚÊËÚY
˜ËšZYÚ
NÉ
	Ü˜][ÉÊK^ÛÛ[XPÑH	Ê˜][ÊŒL
KÑš^Y
J_IXİ\]J˜][Ë\™›Ü›X[˜ÙK››İÊ
J_X\Ş[˜È[˜İ[ÛˆØ[
ÚXÚ
^ÚYŠ˜][ÏO[[
\™]\›ˆ[\
	û%¯:­m;'m;.m:êe:çn;%ä:ìí;%ë;(ï;!.;&¥‰ÊNÛ]OV×K\\™›Ü›X[˜ÙK››İÊ
NİÚ[J\™›Ü›X[˜ÙK››İÊ
K]L
^ÚYŠ˜][ÊXKœ\Ú
˜][ÊNØ]ØZ]™]È›ÛZ\ÙJOœÙ][Y[İ]
‹Œ
J_XKœÛÜ

KŠOO˜KXŠNÛ]OXVØK›[™İŒWNÚYŠÚXÚOOIİ\	Ê^İ\[NÉ
	İ\˜[	ÊK^ÛÛ[JJŒL
KÑš^Y
JJÉÉIßY[Ù^ÙİÛ[NÉ
	ÙİÛ•˜[	ÊK^ÛÛ[JJŒL
KÑš^Y
JJÉÉIß\İ]OIÕĞRU	ÎÜİ
\	‰™İÛÉÔ‘PQIÎ‰ĞĞSP”UIÊ_I
	Ü\Úİ\	ÊK›Û˜ÛXÚÏ\İ\É
	Ü\ÚİÜ	ÊK›Û˜ÛXÚÏJ
OOœİÜ
JNÉ
	Ü\Ú™\Ù]	ÊK›Û˜ÛXÚÏJ
OOÜ™\ÏLÜİ]OIÕĞRU	ÎÉ
	Ü™\ÉÊK^ÛÛ[LÜİ
	Ô‘PQIÊ_NÉ
	ØØ[\	ÊK›Û˜ÛXÚÏJ
OO˜Ø[
	İ\	ÊNÉ
	ØØ[İÛ‰ÊK›Û˜ÛXÚÏJ
OO˜Ø[
	ÙİÛ‰ÊN
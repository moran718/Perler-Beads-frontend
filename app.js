// ==========================================================================
// 拼豆像素化工具前端核心逻辑
// ==========================================================================

const API_BASE = 'https://perler-beads-backend.onrender.com/api';

// 全局状态变量
let selectedFile = null;
let croppedBlob = null; // 保存裁剪后的局部图片Blob数据
let cropper = null;     // Cropper.js 裁剪实例
let apiData = null; // 后端返回的完整数据
let highlightedColorId = null; // 当前高亮匹配的拼豆ID
let isGridVisible = true;
let isBeadTexture = true;
let isCodesVisible = true; // 是否在图纸上直接标注色号
let originalImageWidth = 52;
let originalImageHeight = 52;

// Canvas 平移与缩放状态
const canvas = document.getElementById('bead-canvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('canvas-container');

let scale = 15;        // 缩放比例（每个格子的像素大小）
let offsetX = 0;       // 画布在X轴的平移偏移
let offsetY = 0;       // 画布在Y轴的平移偏移
let isDragging = false;
let startX = 0;
let startY = 0;

// ==========================================================================
// DOM 元素初始化与事件绑定
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    // 上传区域事件
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const removeImgBtn = document.getElementById('remove-img-btn');
    const thumbnailImg = document.getElementById('thumbnail-img');
    const previewThumbnail = document.getElementById('preview-thumbnail');
    const generateBtn = document.getElementById('generate-btn');

    fileInput.addEventListener('change', handleFileSelect);
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            setUploadedFile(e.dataTransfer.files[0]);
        }
    });

    removeImgBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearUploadedFile();
    });

    // 尺寸设定预设按钮
    const presetButtons = document.querySelectorAll('.preset-btn');
    const customSizeInputs = document.getElementById('custom-size-inputs');
    const widthInput = document.getElementById('grid-width');
    const heightInput = document.getElementById('grid-height');
    const sizeDisplay = document.getElementById('size-display');

    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            presetButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const w = btn.getAttribute('data-w');
            const h = btn.getAttribute('data-h');

            if (w === 'custom') {
                customSizeInputs.classList.remove('hidden');
                updateSizeDisplay(widthInput.value, heightInput.value);
            } else if (w === 'original') {
                customSizeInputs.classList.add('hidden');
                if (selectedFile) {
                    const optSize = getOptimalOriginalSize();
                    widthInput.value = optSize.w;
                    heightInput.value = optSize.h;
                    updateSizeDisplay(optSize.w, optSize.h);
                    if (originalImageWidth > 200 || originalImageHeight > 200) {
                        showToast(`原图分辨率为 ${originalImageWidth}x${originalImageHeight} 较大，已自动等比例缩放为 ${optSize.w}x${optSize.h} 颗豆子。`, 'info');
                    }
                } else {
                    widthInput.value = 52;
                    heightInput.value = 52;
                    updateSizeDisplay('原图', '原图');
                    showToast('请先上传图片以读取原图尺寸', 'info');
                }
            } else {
                customSizeInputs.classList.add('hidden');
                widthInput.value = w;
                heightInput.value = h;
                updateSizeDisplay(w, h);
            }
        });
    });

    const onCustomSizeChange = () => {
        // 限制尺寸在合理区间内
        let w = parseInt(widthInput.value) || 29;
        let h = parseInt(heightInput.value) || 29;
        if (w < 5) w = 5; if (w > 150) w = 150;
        if (h < 5) h = 5; if (h > 150) h = 150;
        widthInput.value = w;
        heightInput.value = h;
        updateSizeDisplay(w, h);
    };
    widthInput.addEventListener('change', onCustomSizeChange);
    heightInput.addEventListener('change', onCustomSizeChange);

    // 限色滑块控制
    const maxColorsSlider = document.getElementById('max-colors');
    const colorsDisplay = document.getElementById('colors-display');
    const unlimitedCheckbox = document.getElementById('unlimited-colors');

    // 初始化时同步限色滑块禁用状态
    maxColorsSlider.disabled = unlimitedCheckbox.checked;

    unlimitedCheckbox.addEventListener('change', () => {
        const isUnlimited = unlimitedCheckbox.checked;
        maxColorsSlider.disabled = isUnlimited;
        if (isUnlimited) {
            colorsDisplay.textContent = '无限制';
        } else {
            colorsDisplay.textContent = `${maxColorsSlider.value} 色`;
        }
    });

    maxColorsSlider.addEventListener('input', () => {
        // 用户拉动滑块时，自动解除“不限颜色”勾选，并更新显示文本
        if (unlimitedCheckbox.checked) {
            unlimitedCheckbox.checked = false;
            maxColorsSlider.disabled = false;
        }
        colorsDisplay.textContent = `${maxColorsSlider.value} 色`;
    });

    // 核心像素化动作
    generateBtn.addEventListener('click', sendPixelationRequest);

    // Canvas 画布控制按钮
    document.getElementById('zoom-in').addEventListener('click', () => zoom(1.2));
    document.getElementById('zoom-out').addEventListener('click', () => zoom(0.8));
    document.getElementById('zoom-fit').addEventListener('click', fitToScreen);

    const toggleGridBtn = document.getElementById('toggle-grid');
    toggleGridBtn.addEventListener('click', () => {
        isGridVisible = !isGridVisible;
        toggleGridBtn.classList.toggle('active', isGridVisible);
        draw();
    });

    const toggleStyleBtn = document.getElementById('toggle-style');
    toggleStyleBtn.addEventListener('click', () => {
        isBeadTexture = !isBeadTexture;
        toggleStyleBtn.classList.toggle('active', isBeadTexture);
        draw();
    });

    const toggleCodesBtn = document.getElementById('toggle-codes');
    toggleCodesBtn.addEventListener('click', () => {
        isCodesVisible = !isCodesVisible;
        toggleCodesBtn.classList.toggle('active', isCodesVisible);
        draw();
    });

    // 鼠标拖拽和平移 Canvas
    canvas.addEventListener('mousedown', startPan);
    window.addEventListener('mousemove', pan);
    window.addEventListener('mouseup', endPan);
    container.addEventListener('wheel', handleWheel);

    // 鼠标悬停色号提示事件
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // 导出文件
    document.getElementById('export-img-btn').addEventListener('click', exportHighResImage);
    document.getElementById('export-pdf-btn').addEventListener('click', exportPDFReport);

    // 绑定图片裁剪弹窗逻辑
    const cropModal = document.getElementById('crop-modal');
    const cropConfirmBtn = document.getElementById('crop-confirm-btn');
    const cropCancelBtn = document.getElementById('crop-cancel-btn');
    const closeCropModal = document.getElementById('close-crop-modal');
    const ratio11 = document.getElementById('ratio-1-1');
    const ratioFree = document.getElementById('ratio-free');

    const cropSkipBtn = document.getElementById('crop-skip-btn');

    const hideModal = () => {
        cropModal.classList.add('hidden');
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
    };

    cropCancelBtn.addEventListener('click', hideModal);
    closeCropModal.addEventListener('click', hideModal);

    cropSkipBtn.addEventListener('click', () => {
        croppedBlob = null; // 标记无需裁剪，直接采用原画发送给后端

        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('thumbnail-img').src = e.target.result;
            document.getElementById('preview-thumbnail').classList.remove('hidden');
            document.getElementById('generate-btn').disabled = false;

            const img = new Image();
            img.onload = () => {
                originalImageWidth = img.width;
                originalImageHeight = img.height;

                // 若当前为原图大小，同步更新尺寸
                const activePreset = document.querySelector('.preset-btn.active');
                if (activePreset && activePreset.getAttribute('data-w') === 'original') {
                    const optSize = getOptimalOriginalSize();
                    document.getElementById('grid-width').value = optSize.w;
                    document.getElementById('grid-height').value = optSize.h;
                    updateSizeDisplay(optSize.w, optSize.h);
                    if (originalImageWidth > 200 || originalImageHeight > 200) {
                        showToast(`原图分辨率为 ${originalImageWidth}x${originalImageHeight} 较大，已自动等比例缩放为 ${optSize.w}x${optSize.h} 颗豆子。`, 'info');
                    }
                }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(selectedFile);

        hideModal();
        showToast('已跳过裁剪，直接使用原图', 'success');
    });

    ratio11.addEventListener('click', () => {
        ratio11.classList.add('active');
        ratioFree.classList.remove('active');
        if (cropper) cropper.setAspectRatio(1);
    });

    ratioFree.addEventListener('click', () => {
        ratioFree.classList.add('active');
        ratio11.classList.remove('active');
        if (cropper) cropper.setAspectRatio(NaN);
    });

    cropConfirmBtn.addEventListener('click', () => {
        if (!cropper) return;

        cropper.getCroppedCanvas({
            maxWidth: 1024, // 限制最大输出大小防卡死
            maxHeight: 1024
        }).toBlob((blob) => {
            if (!blob) {
                showToast('裁剪图片失败', 'error');
                return;
            }
            croppedBlob = blob;

            // 将缩略图更改为裁剪后的图片预览
            const url = URL.createObjectURL(blob);
            document.getElementById('thumbnail-img').src = url;
            document.getElementById('preview-thumbnail').classList.remove('hidden');
            document.getElementById('generate-btn').disabled = false;

            // 提取裁剪后的图片尺寸
            const img = new Image();
            img.onload = () => {
                originalImageWidth = img.width;
                originalImageHeight = img.height;

                // 若当前为原图比例，同步修改大小提示并等比缩放限制
                const activePreset = document.querySelector('.preset-btn.active');
                if (activePreset && activePreset.getAttribute('data-w') === 'original') {
                    const optSize = getOptimalOriginalSize();
                    document.getElementById('grid-width').value = optSize.w;
                    document.getElementById('grid-height').value = optSize.h;
                    updateSizeDisplay(optSize.w, optSize.h);
                    if (originalImageWidth > 200 || originalImageHeight > 200) {
                        showToast(`裁剪区域分辨率为 ${originalImageWidth}x${originalImageHeight}，已自动等比缩放为 ${optSize.w}x${optSize.h} 颗豆子。`, 'info');
                    }
                }
            };
            img.src = url;

            hideModal();
            showToast('已应用裁剪图像', 'success');
        }, 'image/png');
    });
});

// ==========================================================================
// 上传及参数联动控制辅助函数
// ==========================================================================
// 智能等比缩放尺寸，限制在最大 200 像素网格以内
function getOptimalOriginalSize() {
    let targetW = originalImageWidth;
    let targetH = originalImageHeight;
    if (targetW > 200 || targetH > 200) {
        const ratio = targetW / targetH;
        if (targetW > targetH) {
            targetW = 200;
            targetH = Math.round(200 / ratio);
        } else {
            targetH = 200;
            targetW = Math.round(200 * ratio);
        }
    }
    return { w: targetW, h: targetH };
}

function updateSizeDisplay(w, h) {
    document.getElementById('size-display').textContent = `${w} x ${h}`;
}

function handleFileSelect(e) {
    if (e.target.files.length > 0) {
        setUploadedFile(e.target.files[0]);
    }
}

function setUploadedFile(file) {
    if (!file.type.startsWith('image/')) {
        showToast('请选择有效的图片文件', 'error');
        return;
    }
    selectedFile = file;
    croppedBlob = null; // 重置之前可能的裁剪

    // 显示裁剪模态弹窗
    const reader = new FileReader();
    reader.onload = (e) => {
        const cropImage = document.getElementById('crop-image');
        cropImage.src = e.target.result;

        const cropModal = document.getElementById('crop-modal');
        cropModal.classList.remove('hidden');

        // 延迟初始化以确保图片已经完成布局渲染
        setTimeout(() => {
            if (cropper) {
                cropper.destroy();
            }
            // 默认重置为 1:1
            document.getElementById('ratio-1-1').classList.add('active');
            document.getElementById('ratio-free').classList.remove('active');

            cropper = new Cropper(cropImage, {
                aspectRatio: 1, // 默认 1:1
                viewMode: 1,    // 限制裁剪框范围在图片内
                autoCropArea: 0.85,
                responsive: true
            });
        }, 120);
    };
    reader.readAsDataURL(file);
}

function clearUploadedFile() {
    selectedFile = null;
    croppedBlob = null;
    document.getElementById('file-input').value = '';
    document.getElementById('preview-thumbnail').classList.add('hidden');
    document.getElementById('thumbnail-img').src = '';
    document.getElementById('generate-btn').disabled = true;
}

// ==========================================================================
// API 请求与响应处理
// ==========================================================================
async function sendPixelationRequest() {
    if (!selectedFile) return;

    // 提取表单数据
    const widthInput = document.getElementById('grid-width');
    const heightInput = document.getElementById('grid-height');
    const w = parseInt(widthInput.value) || 29;
    const h = parseInt(heightInput.value) || 29;

    // 进行合理的最大尺寸校验，防止过大图片直接卡死页面与后端
    if (w > 200 || h > 200) {
        showToast(`网格尺寸 (${w}x${h}) 超过单边 200 颗的最大限制，建议缩小图片或在自定义中将尺寸限制在 200 以内。`, 'error');
        return;
    }

    const unlimitedColors = document.getElementById('unlimited-colors').checked;
    const maxColorsVal = document.getElementById('max-colors').value;
    const enableDither = document.getElementById('enable-dither').checked;

    const formData = new FormData();
    // 优先采用裁剪后的图像 Blob。若有裁剪，以 cropped_image.png 发送，确保后端接口识别有文件名
    const fileToUpload = croppedBlob ? croppedBlob : selectedFile;
    const fileName = croppedBlob ? 'cropped_image.png' : selectedFile.name;
    formData.append('file', fileToUpload, fileName);
    formData.append('width', widthInput.value);
    formData.append('height', heightInput.value);
    formData.append('dither', enableDither.toString());
    if (!unlimitedColors) {
        formData.append('maxColors', maxColorsVal);
    }

    // 显示 loading 遮罩
    document.getElementById('loading-overlay').classList.remove('hidden');
    document.getElementById('canvas-placeholder').classList.add('hidden');

    try {
        const response = await fetch(`${API_BASE}/pixelate`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || '服务器处理失败');
        }

        const data = await response.json();
        apiData = data;
        highlightedColorId = null; // 清除之前的高亮

        // 隐藏 loading 遮罩并展示操作栏
        document.getElementById('loading-overlay').classList.add('hidden');
        document.getElementById('canvas-footer-tip').classList.remove('hidden');

        // 渲染 Canvas 和物料清单
        fitToScreen();
        renderBeadsList(data.beadCounts);

        // 启用下载和导出按钮
        document.getElementById('export-img-btn').disabled = false;
        document.getElementById('export-pdf-btn').disabled = false;

        showToast('图纸生成成功！', 'success');

    } catch (err) {
        document.getElementById('loading-overlay').classList.add('hidden');
        document.getElementById('canvas-placeholder').classList.remove('hidden');
        showToast(err.message || '网络连接失败，请检查后端服务是否启动', 'error');
        console.error(err);
    }
}

// ==========================================================================
// Canvas 绘制与视口控制算法 (核心渲染引擎)
// ==========================================================================
function draw() {
    if (!apiData || !apiData.pixels) return;

    const gridW = apiData.width;
    const gridH = apiData.height;

    // 清除画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // 应用平移与缩放矩阵变换
    ctx.translate(canvas.width / 2 + offsetX, canvas.height / 2 + offsetY);

    // 绘制像素颗粒
    for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
            const colorObj = apiData.pixels[y][x];
            if (!colorObj) continue;

            const pixelX = (x - gridW / 2) * scale;
            const pixelY = (y - gridH / 2) * scale;

            ctx.save();

            // 局部颜色高亮过滤逻辑
            if (highlightedColorId !== null) {
                if (colorObj.id !== highlightedColorId) {
                    ctx.globalAlpha = 0.12; // 降亮未选中的颜色
                } else {
                    ctx.globalAlpha = 1.0;
                    // 在选中的拼豆外面绘制一层外发光轮廓
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = Math.max(1, scale * 0.08);
                    ctx.strokeRect(pixelX, pixelY, scale, scale);
                }
            }

            // 绘制像素色块或拼豆实体圆形质感
            if (isBeadTexture) {
                // 拼豆大圆盘
                ctx.fillStyle = colorObj.hex;
                ctx.beginPath();
                ctx.arc(pixelX + scale / 2, pixelY + scale / 2, scale * 0.45, 0, Math.PI * 2);
                ctx.fill();

                // 圆盘轻微的立体光泽面 (左上偏白高光)
                ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.beginPath();
                ctx.arc(pixelX + scale * 0.38, pixelY + scale * 0.38, scale * 0.12, 0, Math.PI * 2);
                ctx.fill();

                // 拼豆中央的穿孔 (镂空背景色效果，为方便区分采用深色)
                // 当开启显示色号且缩放足够大显示文字时，不绘制孔洞，避免与色号文字重合冲突
                if (!isCodesVisible || scale < 10) {
                    ctx.fillStyle = '#07090f';
                    ctx.beginPath();
                    ctx.arc(pixelX + scale / 2, pixelY + scale / 2, scale * 0.15, 0, Math.PI * 2);
                    ctx.fill();
                }

            } else {
                // 传统正方形像素点
                ctx.fillStyle = colorObj.hex;
                ctx.fillRect(pixelX, pixelY, scale, scale);
            }

            // 若开启显示色号，且缩放比例足够大 (scale >= 10)，在拼豆中央绘制出其对应的色系编号 (如 A1, D25) 辅助定位
            if (isCodesVisible && scale >= 10) {
                // 基于 YUV 亮度公式智能判定采用黑字还是白字，保证不同深浅背景下均清晰可读
                const brightness = (colorObj.r * 299 + colorObj.g * 587 + colorObj.b * 114) / 1000;
                ctx.fillStyle = brightness > 130 ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.85)';
                ctx.font = `bold ${Math.max(8, Math.floor(scale * 0.38))}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(colorObj.code, pixelX + scale / 2, pixelY + scale / 2);
            }

            ctx.restore();
        }
    }

    // 绘制像素对位网格线
    if (isGridVisible && scale > 4) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 0.5;

        // 绘制普通网格细线
        ctx.beginPath();
        for (let x = 0; x <= gridW; x++) {
            const posX = (x - gridW / 2) * scale;
            ctx.moveTo(posX, -gridH / 2 * scale);
            ctx.lineTo(posX, gridH / 2 * scale);
        }
        for (let y = 0; y <= gridH; y++) {
            const posY = (y - gridH / 2) * scale;
            ctx.moveTo(-gridW / 2 * scale, posY);
            ctx.lineTo(gridW / 2 * scale, posY);
        }
        ctx.stroke();

        // 辅助拼豆对位粗线 (每 5 个格子的边界线加粗显示)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let x = 0; x <= gridW; x += 5) {
            const posX = (x - gridW / 2) * scale;
            ctx.moveTo(posX, -gridH / 2 * scale);
            ctx.lineTo(posX, gridH / 2 * scale);
        }
        for (let y = 0; y <= gridH; y += 5) {
            const posY = (y - gridH / 2) * scale;
            ctx.moveTo(-gridW / 2 * scale, posY);
            ctx.lineTo(gridW / 2 * scale, posY);
        }
        ctx.stroke();
    }

    ctx.restore();
}

// 适应屏幕的缩放比例及平移重置
function fitToScreen() {
    if (!apiData) return;

    // 调整 canvas 物理分辨率与 CSS 容器一致
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    const gridW = apiData.width;
    const gridH = apiData.height;

    // 根据高宽比计算最佳缩放尺度，使得像素网格最大化呈现在容器中
    const scaleX = (canvas.width - 60) / gridW;
    const scaleY = (canvas.height - 60) / gridH;
    scale = Math.floor(Math.min(scaleX, scaleY));
    if (scale < 3) scale = 3;

    // 重置偏移量到中心
    offsetX = 0;
    offsetY = 0;

    draw();
}

// 滚轮缩放事件
function handleWheel(e) {
    if (!apiData) return;
    e.preventDefault();

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    zoom(zoomFactor);
}

function zoom(factor) {
    const newScale = scale * factor;
    // 允许缩放到最小 2px，最大 150px 以便看清每一个精细豆子
    if (newScale >= 2 && newScale <= 150) {
        scale = newScale;
        draw();
    }
}

// 鼠标拖拽平移事件
function startPan(e) {
    if (!apiData) return;
    isDragging = true;
    startX = e.clientX - offsetX;
    startY = e.clientY - offsetY;
}

function pan(e) {
    if (!isDragging) return;
    offsetX = e.clientX - startX;
    offsetY = e.clientY - startY;
    draw();
}

function endPan() {
    isDragging = false;
}

// ==========================================================================
// 拼豆物料清单与交互逻辑
// ==========================================================================
function renderBeadsList(beadCounts) {
    const beadsListDiv = document.getElementById('beads-list');
    const placeholder = document.getElementById('list-placeholder');
    const totalCountText = document.getElementById('total-beads-count');

    // 累加总豆子颗数
    let totalBeads = 0;
    beadCounts.forEach(b => totalBeads += b.count);
    totalCountText.textContent = `共 ${totalBeads} 颗`;

    beadsListDiv.innerHTML = '';
    placeholder.classList.add('hidden');
    beadsListDiv.classList.remove('hidden');

    beadCounts.forEach(item => {
        const color = item.color;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'bead-item';
        itemDiv.setAttribute('data-color-id', color.id);

        // 点击清单项切换高亮高光状态
        itemDiv.addEventListener('click', () => {
            const isActive = itemDiv.classList.contains('active');

            // 取消所有高亮
            document.querySelectorAll('.bead-item').forEach(el => el.classList.remove('active'));

            if (isActive) {
                highlightedColorId = null;
            } else {
                itemDiv.classList.add('active');
                highlightedColorId = color.id;
            }

            draw();
        });

        itemDiv.innerHTML = `
            <div class="bead-color-sphere" style="background-color: ${color.hex};"></div>
            <div class="bead-info">
                <div class="bead-title">
                    <span class="bead-name">${color.name} (${color.englishName})</span>
                    <span class="bead-code">${color.brand} ${color.code.charAt(0)}系列 - ${color.code}</span>
                </div>
                <div class="bead-quantity-row">
                    <span>十六进制: ${color.hex}</span>
                    <span>用量: <span class="bead-count">${item.count}</span> 颗</span>
                </div>
            </div>
        `;
        beadsListDiv.appendChild(itemDiv);
    });
}

// ==========================================================================
// 物料清单导出和高清图纸保存
// ==========================================================================

// 保存高清像素网格图纸
function exportHighResImage() {
    if (!apiData) return;

    const gridW = apiData.width;
    const gridH = apiData.height;
    const exportCellSize = 30; // 导出固定大格子尺寸以确保图纸高清

    // 创建临时高精度 Canvas 容器
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = gridW * exportCellSize + 40;
    tempCanvas.height = gridH * exportCellSize + 40;
    const tempCtx = tempCanvas.getContext('2d');

    // 绘制深色底图背景
    tempCtx.fillStyle = '#07090f';
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    tempCtx.save();
    tempCtx.translate(20, 20); // 留出 20px 边框

    // 绘制像素色块或拼豆圆形
    for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
            const colorObj = apiData.pixels[y][x];
            if (!colorObj) continue;

            const pixelX = x * exportCellSize;
            const pixelY = y * exportCellSize;

            if (isBeadTexture) {
                // 拼豆大圆盘
                tempCtx.fillStyle = colorObj.hex;
                tempCtx.beginPath();
                tempCtx.arc(pixelX + exportCellSize / 2, pixelY + exportCellSize / 2, exportCellSize * 0.45, 0, Math.PI * 2);
                tempCtx.fill();

                // 圆盘轻微的立体光泽面
                tempCtx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                tempCtx.beginPath();
                tempCtx.arc(pixelX + exportCellSize * 0.38, pixelY + exportCellSize * 0.38, exportCellSize * 0.12, 0, Math.PI * 2);
                tempCtx.fill();

                // 穿孔 (如果显示色号，就不绘制穿孔以防文字被遮挡冲突)
                if (!isCodesVisible) {
                    tempCtx.fillStyle = '#07090f';
                    tempCtx.beginPath();
                    tempCtx.arc(pixelX + exportCellSize / 2, pixelY + exportCellSize / 2, exportCellSize * 0.15, 0, Math.PI * 2);
                    tempCtx.fill();
                }
            } else {
                tempCtx.fillStyle = colorObj.hex;
                tempCtx.fillRect(pixelX, pixelY, exportCellSize, exportCellSize);
            }

            // 导出高清图纸时同样印上色系编号，极大地方便打印后物理对照摆豆
            if (isCodesVisible) {
                const brightness = (colorObj.r * 299 + colorObj.g * 587 + colorObj.b * 114) / 1000;
                tempCtx.fillStyle = brightness > 130 ? 'rgba(0, 0, 0, 0.65)' : 'rgba(255, 255, 255, 0.8)';
                tempCtx.font = 'bold 9px sans-serif';
                tempCtx.textAlign = 'center';
                tempCtx.textBaseline = 'middle';
                tempCtx.fillText(colorObj.code, pixelX + exportCellSize / 2, pixelY + exportCellSize / 2);
            }
        }
    }

    // 绘制网格线
    if (isGridVisible) {
        tempCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        tempCtx.lineWidth = 0.5;
        tempCtx.beginPath();
        for (let x = 0; x <= gridW; x++) {
            tempCtx.moveTo(x * exportCellSize, 0);
            tempCtx.lineTo(x * exportCellSize, gridH * exportCellSize);
        }
        for (let y = 0; y <= gridH; y++) {
            tempCtx.moveTo(0, y * exportCellSize);
            tempCtx.lineTo(gridW * exportCellSize, y * exportCellSize);
        }
        tempCtx.stroke();

        // 5格对位辅助线
        tempCtx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        tempCtx.lineWidth = 1.2;
        tempCtx.beginPath();
        for (let x = 0; x <= gridW; x += 5) {
            tempCtx.moveTo(x * exportCellSize, 0);
            tempCtx.lineTo(x * exportCellSize, gridH * exportCellSize);
        }
        for (let y = 0; y <= gridH; y += 5) {
            tempCtx.moveTo(0, y * exportCellSize);
            tempCtx.lineTo(gridW * exportCellSize, y * exportCellSize);
        }
        tempCtx.stroke();
    }

    tempCtx.restore();

    // 转换为图片并下载
    const link = document.createElement('a');
    link.download = `PixelBead_Pattern_${gridW}x${gridH}.png`;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();

    showToast('高清像素图纸下载中！', 'success');
}

// 导出 PDF 拼豆报告（使用 html2pdf 库直接生成并下载 PDF）
function exportPDFReport() {
    if (!apiData) return;

    // 创建一个临时的 DOM 容器用于生成 PDF
    const element = document.createElement('div');
    element.style.padding = '30px 40px';
    element.style.color = '#333';
    element.style.backgroundColor = '#ffffff';
    element.style.fontFamily = 'Helvetica Neue, Arial, sans-serif';

    // 生成精美色块清单 HTML
    let tableRowsHtml = '';
    apiData.beadCounts.forEach(item => {
        tableRowsHtml += `
            <tr style="border-bottom: 1px solid #eeeeee;">
                <td style="padding: 10px; font-size: 13px; font-family: monospace;">
                    <div style="width: 16px; height: 16px; border-radius: 50%; background-color: ${item.color.hex}; border: 1px solid #cccccc; display: inline-block; vertical-align: middle; margin-right: 8px;"></div>
                    <span style="vertical-align: middle;">${item.color.hex}</span>
                </td>
                <td style="padding: 10px; font-weight: bold; font-size: 13px;">${item.color.brand} ${item.color.code.charAt(0)}系列 - ${item.color.code}</td>
                <td style="padding: 10px; font-size: 13px;">${item.color.name} (${item.color.englishName})</td>
                <td style="padding: 10px; font-weight: bold; color: #0082ff; font-size: 13px;">${item.count} 颗</td>
            </tr>
        `;
    });

    // 计算总用量
    let totalBeads = apiData.beadCounts.reduce((sum, item) => sum + item.count, 0);

    element.innerHTML = `
        <div style="border-bottom: 3px solid #0082ff; padding-bottom: 15px; margin-bottom: 20px;">
            <h1 style="color: #0082ff; margin: 0 0 8px 0; font-size: 26px;">拼豆物料清单</h1>
            <div style="color: #666; font-size: 13px;">
                规格尺寸: <strong>${apiData.width} x ${apiData.height}</strong> 颗粒 | 
                使用颜色: <strong>${apiData.beadCounts.length}</strong> 种 | 
                总颗数需求: <strong style="color: #0082ff; font-size: 15px;">${totalBeads}</strong> 颗
            </div>
        </div>
        
        <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <thead>
                <tr style="background-color: #f8f9fa; border-bottom: 2px solid #dddddd;">
                    <th style="padding: 12px 10px; font-size: 14px; color: #555555; width: 25%;">十六进制</th>
                    <th style="padding: 12px 10px; font-size: 14px; color: #555555; width: 30%;">官方色号</th>
                    <th style="padding: 12px 10px; font-size: 14px; color: #555555; width: 30%;">色号名称</th>
                    <th style="padding: 12px 10px; font-size: 14px; color: #555555; width: 15%;">需求数量</th>
                </tr>
            </thead>
            <tbody>
                ${tableRowsHtml}
            </tbody>
        </table>
        
        <div style="margin-top: 30px; text-align: center; color: #999999; font-size: 11px; border-top: 1px dashed #dddddd; padding-top: 15px;">
            此清单由 PixelBead 智能像素化拼豆辅助工具生成。
        </div>
    `;

    // 设定 html2pdf 的导出选项
    const opt = {
        margin: 15,
        filename: `PixelBead_Material_List_${apiData.width}x${apiData.height}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // 执行转换并下载 PDF
    html2pdf().set(opt).from(element).save();

    showToast('PDF 清单已开始生成并下载！', 'success');
}

// 获取鼠标位置对应的拼豆数据
function getBeadUnderMouse(e) {
    if (!apiData || !apiData.pixels) return null;

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    const gridW = apiData.width;
    const gridH = apiData.height;

    // 考虑到 Canvas 的平移和缩放
    const tx = canvasX - (canvas.width / 2 + offsetX);
    const ty = canvasY - (canvas.height / 2 + offsetY);

    const x = Math.floor(tx / scale + gridW / 2);
    const y = Math.floor(ty / scale + gridH / 2);

    if (x >= 0 && x < gridW && y >= 0 && y < gridH) {
        return { x, y, color: apiData.pixels[y][x] };
    }
    return null;
}

// 鼠标悬停提示
function handleMouseMove(e) {
    if (isDragging) {
        document.getElementById('bead-tooltip').classList.add('hidden');
        return;
    }

    const bead = getBeadUnderMouse(e);
    const tooltip = document.getElementById('bead-tooltip');

    if (bead && bead.color) {
        const color = bead.color;
        tooltip.innerHTML = `
            <div class="tooltip-color-sphere" style="background-color: ${color.hex};"></div>
            <div class="tooltip-info">
                <div class="tooltip-title">${color.brand} ${color.code} - ${color.name}</div>
                <div class="tooltip-desc">${color.englishName} | ${color.hex}</div>
            </div>
        `;

        const containerRect = container.getBoundingClientRect();
        let tooltipX = e.clientX - containerRect.left + 15;
        let tooltipY = e.clientY - containerRect.top + 15;

        // 防止溢出容器
        const tooltipWidth = 240;
        const tooltipHeight = 60;
        if (tooltipX + tooltipWidth > containerRect.width) {
            tooltipX = e.clientX - containerRect.left - tooltipWidth - 15;
        }
        if (tooltipY + tooltipHeight > containerRect.height) {
            tooltipY = e.clientY - containerRect.top - tooltipHeight - 15;
        }

        tooltip.style.left = `${tooltipX}px`;
        tooltip.style.top = `${tooltipY}px`;
        tooltip.classList.remove('hidden');
    } else {
        tooltip.classList.add('hidden');
    }
}

function handleMouseLeave() {
    document.getElementById('bead-tooltip').classList.add('hidden');
}

// ==========================================================================
// Toast 弹窗通知
// ==========================================================================
let toastTimeout;
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.className = `toast ${type === 'error' ? 'toast-error' : 'toast-success'}`;
    toast.innerHTML = type === 'error'
        ? `<i class="fa-solid fa-circle-exclamation"></i> ${message}`
        : `<i class="fa-solid fa-circle-check"></i> ${message}`;

    toast.classList.remove('hidden');

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

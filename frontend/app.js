const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const leftPanel = document.getElementById('left-panel');
const rightPanel = document.getElementById('right-panel');
const controls = document.getElementById('controls');
const documentContent = document.getElementById('document-content');
const dispatchBtn = document.getElementById('dispatch-btn');
const feed = document.getElementById('feed');
const legendContainer = document.getElementById('agent-legend');
const tooltip = document.getElementById('insight-tooltip');
const downloadBtn = document.getElementById('download-btn');

// --- State Management ---
let globalSentenceState = {}; 
let activeAgentFilters = {};
let tooltipTimeout;

const HOVER_DELAY_MS = 800; 
const CURSOR_OFFSET = 5;    

// --- Helper: Convert Hex to RGB ---
const hexToRgb = (hex) => {
    let r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
};

// --- API Key Modal Logic ---
const apiKeyModal = document.getElementById('api-key-modal');
const modalApiKeyInput = document.getElementById('modal-api-key-input');
const providerSelect = document.getElementById('provider-select');
const modalSaveBtn = document.getElementById('modal-save-btn');
const testConnectionBtn = document.getElementById('test-connection-btn');
const demoModeBtn = document.getElementById('demo-mode-btn');
const rememberKeyCheckbox = document.getElementById('remember-key-checkbox');
const validationMessage = document.getElementById('validation-message');
const toggleVisibilityBtn = document.getElementById('toggle-key-visibility');
const toastContainer = document.getElementById('toast-container');

let savedApiKey = localStorage.getItem('auditflow_api_key') || sessionStorage.getItem('auditflow_api_key');

if (savedApiKey) {
    apiKeyModal.style.display = 'none';
} else {
    // The CSS defaults to display: flex; but let's be explicit
    apiKeyModal.style.display = 'flex';
}

// Toggle password visibility
toggleVisibilityBtn.addEventListener('click', () => {
    if (modalApiKeyInput.type === 'password') {
        modalApiKeyInput.type = 'text';
    } else {
        modalApiKeyInput.type = 'password';
    }
});

// Toast Helper
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `✅ ${message}`;
    toastContainer.appendChild(toast);
    
    // Remove from DOM after animation completes
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 3500);
}

// Validation API call
async function validateKey(provider, key) {
    try {
        const response = await fetch('/api/validate_key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: provider, api_key: key })
        });
        return await response.json();
    } catch (error) {
        return { status: 'error', message: 'Failed to reach backend server.' };
    }
}

testConnectionBtn.addEventListener('click', async () => {
    const key = modalApiKeyInput.value.trim();
    if (!key) {
        validationMessage.className = 'validation-message error';
        validationMessage.innerText = 'Please enter an API Key to test.';
        return;
    }
    
    testConnectionBtn.disabled = true;
    testConnectionBtn.innerText = 'Testing...';
    validationMessage.style.display = 'none';
    
    const result = await validateKey(providerSelect.value, key);
    
    validationMessage.style.display = 'block';
    if (result.status === 'success') {
        validationMessage.className = 'validation-message success';
        validationMessage.innerText = 'Connection successful!';
    } else {
        validationMessage.className = 'validation-message error';
        validationMessage.innerText = result.message || 'Validation failed.';
    }
    
    testConnectionBtn.disabled = false;
    testConnectionBtn.innerText = 'Test Connection';
});

modalSaveBtn.addEventListener('click', async () => {
    const key = modalApiKeyInput.value.trim();
    if (!key) {
        validationMessage.style.display = 'block';
        validationMessage.className = 'validation-message error';
        validationMessage.innerText = 'Please enter a valid API Key.';
        return;
    }

    modalSaveBtn.disabled = true;
    modalSaveBtn.innerText = 'Validating...';
    
    const result = await validateKey(providerSelect.value, key);
    
    if (result.status === 'success') {
        if (rememberKeyCheckbox.checked) {
            localStorage.setItem('auditflow_api_key', key);
            sessionStorage.removeItem('auditflow_api_key');
        } else {
            sessionStorage.setItem('auditflow_api_key', key);
            localStorage.removeItem('auditflow_api_key');
        }
        savedApiKey = key;
        apiKeyModal.style.display = 'none';
        showToast('API Connected Successfully');
    } else {
        validationMessage.style.display = 'block';
        validationMessage.className = 'validation-message error';
        validationMessage.innerText = result.message || 'Validation failed.';
    }
    
    modalSaveBtn.disabled = false;
    modalSaveBtn.innerText = 'Save & Continue';
});

demoModeBtn.addEventListener('click', () => {
    savedApiKey = ''; // Uses backend fallback (.env)
    apiKeyModal.style.display = 'none';
    showToast('Demo Mode Enabled');
});

// --- Drag and Drop Logic ---
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFileUpload(e.target.files[0]);
});

// --- API: Upload & Parse ---
async function handleFileUpload(file) {
    dropZone.innerHTML = "<p class='drop-subtitle'>Uploading and parsing document...</p>";
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        
        if (data.status === 'success') {
            dropZone.style.display = 'none';
            leftPanel.classList.add('active');
            rightPanel.classList.add('active');
            controls.style.display = 'block';

            documentContent.innerHTML = data.sentences.map(para => {
                const paraText = para.sentences.map(s => 
                    `<span class="document-sentence" id="sent-${s.sentence_id}">${s.sentence} </span>`
                ).join('');
                return `<p>${paraText}</p>`;
            }).join('');
        }
    } catch (error) {
        dropZone.innerHTML = `<p style="color: red;">Upload failed. Ensure backend is running.</p>`;
        console.error(error);
    }
}

// --- API: Trigger Multi-Agent Analysis via SSE ---
dispatchBtn.addEventListener('click', () => {
    dispatchBtn.disabled = true;
    dispatchBtn.innerText = "Analyzing concurrently...";
    downloadBtn.style.display = 'none';
    feed.innerHTML = ''; 
    
    legendContainer.style.display = 'none';
    legendContainer.innerHTML = '<div style="font-weight: 600; margin-bottom: 4px;">Active Perspectives</div>';
    
    globalSentenceState = {};
    activeAgentFilters = {};

    savedApiKey = localStorage.getItem('auditflow_api_key') || sessionStorage.getItem('auditflow_api_key') || '';

    // If no key is saved, and we aren't in explicitly "Demo Mode", pop modal
    if (!savedApiKey && apiKeyModal.style.display !== 'none') {
        apiKeyModal.style.display = 'flex';
        dispatchBtn.disabled = false;
        dispatchBtn.innerText = "Dispatch Parallel Agents";
        return;
    }

    const eventSource = new EventSource(`/api/analyze?api_key=${encodeURIComponent(savedApiKey)}`);

    eventSource.onmessage = (event) => {
        const payload = JSON.parse(event.data);

        if (payload.status === 'engine_started' || payload.status === 'aggregator_started') {
            addFeedStatus(payload.message);
        } 
        else if (payload.status === 'agent_report') {
            const agentData = payload.data;
            addAgentCard(agentData);
            registerAgentInLegend(agentData.agent, agentData.color);
            processAgentHighlights(agentData.agent, agentData.color, agentData.insight, agentData.selected_sentence_ids);
        }
        else if (payload.status === 'conflict_report') {
            addConflictReport(payload.data);
        }
        else if (payload.status === 'complete') {
            eventSource.close();
            dispatchBtn.innerText = "Audit Complete";
            addFeedStatus("Workflow Terminated Successfully.");
            legendContainer.style.display = 'flex';
            downloadBtn.style.display = 'block';
        }
    };

    eventSource.onerror = (error) => {
        console.error("SSE Error:", error);
        eventSource.close();
        dispatchBtn.innerText = "Dispatch Parallel Agents";
        dispatchBtn.disabled = false;
    };
});

// --- PDF Download Logic ---
downloadBtn.addEventListener('click', () => {
    // We use native window.print() combined with @media print CSS to generate a perfect PDF
    window.print();
});

// --- UI Rendering Helpers ---
function addFeedStatus(message) {
    const el = document.createElement('div');
    el.className = 'status-text';
    el.innerText = `> ${message}`;
    feed.appendChild(el);
    rightPanel.scrollTop = rightPanel.scrollHeight;
}

function addAgentCard(data) {
    const el = document.createElement('div');
    el.className = 'card agent-card';
    el.style.borderLeftColor = data.color;
    el.innerHTML = `
        <div class="card-title" style="color: ${data.color}; filter: brightness(0.7);">${data.agent}</div>
        <p style="font-size: 0.95rem;">${data.insight}</p>
    `;
    feed.appendChild(el);
    rightPanel.scrollTop = rightPanel.scrollHeight;
}

function addConflictReport(consensus) {
    const el = document.createElement('div');
    el.className = 'card conflict-card';
    let html = `<div class="card-title" style="color: #d93025;">Chief Justice Report</div>`;
    
    if (consensus.has_conflicts && consensus.conflicts) {
        html += `<p style="font-weight: 600; margin-bottom: 8px;">${consensus.summary}</p>`;
        consensus.conflicts.forEach(c => {
            html += `
                <div style="background: rgba(255,255,255,0.7); padding: 8px; border-radius: 4px; margin-top: 8px; border-left: 2px solid #d93025;">
                    <strong>[${c.severity}]</strong> ${c.description} <br>
                    <small style="color: var(--text-secondary)">Involved: ${c.involved_agents.join(', ')}</small>
                </div>
            `;
        });
    } else {
         html += `<p>All executive perspectives are aligned. No critical cross-domain conflicts detected.</p>`;
    }
    
    el.innerHTML = html;
    feed.appendChild(el);
    rightPanel.scrollTop = rightPanel.scrollHeight;
}

// --- Dynamic Highlighting & Legend Logic ---
function registerAgentInLegend(agentName, color) {
    if (activeAgentFilters[agentName] !== undefined) return;

    activeAgentFilters[agentName] = true;

    const label = document.createElement('label');
    label.className = 'legend-item';
    label.innerHTML = `
        <input type="checkbox" checked value="${agentName}">
        <span class="legend-color-box" style="background-color: ${color};"></span>
        ${agentName}
    `;

    label.querySelector('input').addEventListener('change', (e) => {
        activeAgentFilters[agentName] = e.target.checked;
        recalculateAllHighlights();
    });

    legendContainer.appendChild(label);
}

function processAgentHighlights(agentName, color, insight, sentenceIds) {
    if (!sentenceIds) return;

    sentenceIds.forEach(id => {
        if (!globalSentenceState[id]) globalSentenceState[id] = {};
        globalSentenceState[id][agentName] = { color, insight };
    });

    recalculateAllHighlights();
}

function recalculateAllHighlights() {
    for (const [sentenceId, agentsDict] of Object.entries(globalSentenceState)) {
        const sentenceEl = document.getElementById(`sent-${sentenceId}`);
        if (!sentenceEl) continue;

        const activeColors = [];
        for (const [agentName, data] of Object.entries(agentsDict)) {
            if (activeAgentFilters[agentName]) {
                activeColors.push(data.color);
            }
        }

        if (activeColors.length === 0) {
            sentenceEl.style.background = 'transparent';
            sentenceEl.style.borderBottomColor = 'transparent';
            sentenceEl.classList.remove('has-highlight'); 
        } 
        else if (activeColors.length === 1) {
            sentenceEl.classList.add('has-highlight'); 
            const color = activeColors[0];
            sentenceEl.style.background = `rgba(${hexToRgb(color)}, 0.3)`;
            sentenceEl.style.borderBottomColor = color;
        } 
        else {
            sentenceEl.classList.add('has-highlight'); 
            const stripeWidth = 10;
            let gradientStops = [];
            
            activeColors.forEach((color, index) => {
                const rgba = `rgba(${hexToRgb(color)}, 0.4)`;
                const start = index * stripeWidth;
                const end = (index + 1) * stripeWidth;
                gradientStops.push(`${rgba} ${start}px, ${rgba} ${end}px`);
            });

            const totalWidth = activeColors.length * stripeWidth;
            sentenceEl.style.background = `repeating-linear-gradient(45deg, ${gradientStops.join(', ')} 0, ${gradientStops.join(', ')} ${totalWidth}px)`;
            sentenceEl.style.borderBottomColor = '#444746'; 
        }
    }
}

// --- Tooltip Hover Logic (Delayed, Scrollable & Boundary-Aware) ---
documentContent.addEventListener('mouseover', (e) => {
    const sentenceEl = e.target.closest('.document-sentence');
    if (!sentenceEl) return;
    
    const sentenceId = sentenceEl.id.replace('sent-', '');
    const agentsDict = globalSentenceState[sentenceId];
    
    let activeAgentsHtml = '';
    
    if (agentsDict) {
        for (const [agentName, data] of Object.entries(agentsDict)) {
            if (activeAgentFilters[agentName]) {
                activeAgentsHtml += `
                    <div class="tooltip-agent-block">
                        <div class="tooltip-agent-name" style="color: ${data.color}; filter: brightness(0.7);">${agentName}</div>
                        <div class="tooltip-insight-text">${data.insight}</div>
                    </div>
                `;
            }
        }
    }

    if (activeAgentsHtml) {
        clearTimeout(tooltipTimeout);
        tooltip.innerHTML = activeAgentsHtml;
        
        tooltip.style.visibility = 'hidden'; 
        tooltip.style.opacity = '0';
        tooltip.classList.add('visible'); 
        
        const tooltipRect = tooltip.getBoundingClientRect();
        
        let leftPos = e.pageX + CURSOR_OFFSET;
        let topPos = e.pageY + CURSOR_OFFSET;

        if (e.clientX + CURSOR_OFFSET + tooltipRect.width > window.innerWidth) {
            leftPos = e.pageX - tooltipRect.width - CURSOR_OFFSET;
        }

        if (e.clientY + CURSOR_OFFSET + tooltipRect.height > window.innerHeight) {
            topPos = e.pageY - tooltipRect.height - CURSOR_OFFSET;
        }

        tooltip.style.left = `${leftPos}px`;
        tooltip.style.top = `${topPos}px`;
        tooltip.style.visibility = ''; 
        tooltip.style.opacity = '';
    }
});

documentContent.addEventListener('mouseout', (e) => {
    const sentenceEl = e.target.closest('.document-sentence');
    if (sentenceEl) {
        tooltipTimeout = setTimeout(() => {
            tooltip.classList.remove('visible');
        }, HOVER_DELAY_MS); 
    }
});

tooltip.addEventListener('mouseenter', () => {
    clearTimeout(tooltipTimeout);
});

tooltip.addEventListener('mouseleave', () => {
    tooltipTimeout = setTimeout(() => {
        tooltip.classList.remove('visible');
    }, HOVER_DELAY_MS); 
});
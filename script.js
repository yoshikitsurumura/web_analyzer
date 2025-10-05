document.addEventListener('DOMContentLoaded', () => {
    const analyzeBtn = document.getElementById('analyzeBtn');
    const urlInput = document.getElementById('urlInput');
    const tabHeaders = document.getElementById('tab-headers');
    const tabContents = document.getElementById('tab-contents');
    const loadingDiv = document.getElementById('loading');

    // ローカルストレージから採用済み提案を読み込む
    function getAdoptedSuggestions() {
        const adopted = localStorage.getItem('adoptedSuggestions');
        return adopted ? new Set(JSON.parse(adopted)) : new Set();
    }

    // 採用済み提案をローカルストレージに保存する
    function saveAdoptedSuggestion(suggestionId) {
        const adopted = getAdoptedSuggestions();
        adopted.add(suggestionId);
        localStorage.setItem('adoptedSuggestions', JSON.stringify(Array.from(adopted)));
    }

    // 提案のユニークなIDを生成する
    function generateSuggestionId(pageUrl, suggestion) {
        // URL、カテゴリ、original_textを組み合わせてハッシュを生成
        // 簡易的なハッシュとして、文字列を結合して使用
        return `${pageUrl}-${suggestion.category}-${suggestion.original_text}`.replace(/\s+/g, '').substring(0, 100);
    }

    analyzeBtn.addEventListener('click', () => {
        const url = urlInput.value;

        if (!url) {
            alert('URLを入力してください。');
            return;
        }

        
        loadingDiv.style.display = 'block';

        console.log(`分析を開始します。URL: ${url}`);

        fetch('http://127.0.0.1:8000/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url: url }),
        })
        .then(response => {
            if (!response.ok) {
                // HTTPエラーの場合
                return response.json().then(err => { throw new Error(err.detail || 'サーバーエラーが発生しました。'); });
            }
            return response.json();
        })
        .then(data => {
            loadingDiv.style.display = 'none';
            
            // 全体のエラーメッセージが返された場合
            if (data.report) {
                tabContents.innerHTML = `<p style="color: red;">エラーが発生しました: ${data.report}</p>`;
                // raw_responseがあれば表示
                if (data.raw_response && data.raw_response !== "N/A") {
                    tabContents.innerHTML += `<p style="color: red; font-size: 0.8em;">AIからの生応答（デバッグ用）: <pre>${escapeHtml(data.raw_response)}</pre></p>`;
                }
                return;
            }

            const adoptedSuggestions = getAdoptedSuggestions();
            let hasNewSuggestions = false; // 新しい提案があるかどうかのフラグ

            // 複数ページの分析結果を表示
            if (data.pages_analysis && data.pages_analysis.length > 0) {
                // 既存のタブをクリア
                tabHeaders.innerHTML = '';
                tabContents.innerHTML = '';

                data.pages_analysis.forEach((pageAnalysis, index) => {
                    const tabId = `tab-${index}`;
                    const tabHeader = document.createElement('button');
                    tabHeader.classList.add('tab-header');
                    tabHeader.textContent = pageAnalysis.url;
                    tabHeader.dataset.tab = tabId;
                    tabHeaders.appendChild(tabHeader);

                    const tabContent = document.createElement('div');
                    tabContent.classList.add('tab-content');
                    tabContent.id = tabId;

                    tabContent.innerHTML = `<h2>分析結果: <a href="${pageAnalysis.url}" target="_blank">${pageAnalysis.url}</a></h2>`;

                    // AIによる提案キーワードの表示
                    if (pageAnalysis.suggested_keywords && pageAnalysis.suggested_keywords.length > 0) {
                        const keywordTemplate = document.getElementById('keyword-template');
                        const keywordsContainer = keywordTemplate.content.cloneNode(true);
                        const ul = keywordsContainer.querySelector('ul');
                        pageAnalysis.suggested_keywords.forEach(keyword => {
                            const li = document.createElement('li');
                            li.textContent = keyword;
                            ul.appendChild(li);
                        });
                        tabContent.appendChild(keywordsContainer);
                    }

                    if (pageAnalysis.error) {
                        tabContent.innerHTML += `<p style="color: red;">このページの分析中にエラーが発生しました: ${pageAnalysis.error}</p>`;
                        if (pageAnalysis.raw_response && pageAnalysis.raw_response !== "N/A") {
                            tabContent.innerHTML += `<p style="color: red; font-size: 0.8em;">AIからの生応答（デバッグ用）: <pre>${escapeHtml(pageAnalysis.raw_response)}</pre></p>`;
                        }
                    } else if (pageAnalysis.suggestions && pageAnalysis.suggestions.length > 0) {
                        let pageHasNewSuggestions = false;
                        pageAnalysis.suggestions.forEach((suggestion, suggestionIndex) => {
                            const suggestionId = generateSuggestionId(pageAnalysis.url, suggestion);
                            const isAdopted = adoptedSuggestions.has(suggestionId);

                            if (isAdopted) {
                                // 採用済みの場合はスキップして表示しない
                                return;
                            }
                            pageHasNewSuggestions = true;
                            hasNewSuggestions = true;

                            const suggestionCard = document.createElement('div');
                            suggestionCard.classList.add('suggestion-card');
                            suggestionCard.dataset.index = suggestionIndex; // 識別用にインデックスを付与
                            suggestionCard.dataset.pageUrl = pageAnalysis.url; // どのページの提案か
                            suggestionCard.dataset.suggestionId = suggestionId; // 採用済み判定用ID

                            // 提案データをdata属性に保存
                            suggestionCard.dataset.originalText = suggestion.original_text;
                            suggestionCard.dataset.suggestedText = suggestion.suggested_text;
                            suggestionCard.dataset.fileTypeHint = suggestion.file_type_hint;

                            let originalHtml = suggestion.original_text ? `<div class="comparison-item original"><h3>改善前</h3><pre class="code-block">${escapeHtml(suggestion.original_text)}</pre><button class="copy-btn" data-target="original-code-${pageAnalysis.url.replace(/[^a-zA-Z0-9]/g, '')}-${suggestionIndex}">コピー</button></div>` : '';
                            let suggestedHtml = suggestion.suggested_text ? `<div class="comparison-item suggested"><h3>改善後</h3><pre class="code-block">${escapeHtml(suggestion.suggested_text)}</pre><button class="copy-btn" data-target="suggested-code-${pageAnalysis.url.replace(/[^a-zA-Z0-9]/g, '')}-${suggestionIndex}">コピー</button></div>` : '';

                            suggestionCard.innerHTML = `
                                <h2>${suggestionIndex + 1}. ${suggestion.category}</h2>
                                <div class="file-type-hint">
                                    <p><strong>対象ファイルの種類:</strong> ${suggestion.file_type_hint || '不明'}</p>
                                </div>
                                <div class="comparison-container">
                                    ${originalHtml}
                                    ${suggestedHtml}
                                </div>
                                <div class="reason">
                                    <h3>提案理由</h3>
                                    <p>${suggestion.reason}</p>
                                </div>
                                <div class="actions">
                                    <button class="action-btn adopt-btn">採用</button>
                                    <button class="action-btn keep-btn">そのまま</button>
                                </div>
                                <div class="apply-instructions" style="display: none;">
                                    <h3>この変更を適用する方法</h3>
                                    <p>以下の手順で、あなたのプロジェクトファイルを更新してください。</p>
                                    <p>1. あなたのプロジェクト内の <strong>${suggestion.file_type_hint || '該当する'}ファイル</strong> を開いてください。</p>
                                    <p>2. ファイル内で、以下の「改善前」のコードを見つけてください。</p>
                                    <pre id="original-code-${pageAnalysis.url.replace(/[^a-zA-Z0-9]/g, '')}-${suggestionIndex}" class="code-block">${escapeHtml(suggestion.original_text)}</pre>
                                    <p>3. そのコードを、以下の「改善後」のコードに置き換えてください。</p>
                                    <pre id="suggested-code-${pageAnalysis.url.replace(/[^a-zA-Z0-9]/g, '')}-${suggestionIndex}" class="code-block">${escapeHtml(suggestion.suggested_text)}</pre>
                                    <p>変更を保存し、ブラウザで確認してください。</p>
                                    <div class="auto-apply-section">
                                        <h4>自動でファイルを変更しますか？</h4>
                                        <p><strong>注意:</strong> この操作は元に戻せません。必ずファイルのバックアップを取ってから実行してください。</p>
                                        <label for="filePathInput-${suggestionIndex}">ローカルファイルパス:</label>
                                        <input type="text" id="filePathInput-${suggestionIndex}" class="file-path-input" placeholder="例: C:\Users\mayum\my_portfolio\index.html">
                                        <button class="action-btn apply-file-btn" data-index="${suggestionIndex}">変更を適用</button>
                                        <p class="apply-status" id="apply-status-${suggestionIndex}"></p>
                                    </div>
                                </div>
                            `;
                            tabContent.appendChild(suggestionCard);
                        });
                        if (!pageHasNewSuggestions) {
                            tabContent.innerHTML += `<p>このページには新しい改善提案はありませんでした。</p>`;
                        }
                    } else {
                        tabContent.innerHTML += `<p>このページには分析結果がありませんでした。</p>`;
                    }
                    tabContents.appendChild(tabContent);
                });

                if (!hasNewSuggestions) {
                    tabContents.innerHTML = `<p>すべてのページで新しい改善提案は見つかりませんでした。</p>`;
                }

                // 全体の最後のメッセージを追加
                if (data.closing_message) {
                    const closingMessageDiv = document.createElement('div');
                    closingMessageDiv.classList.add('closing-message');
                    closingMessageDiv.innerHTML = `<p>${data.closing_message}</p>`;
                    tabContents.appendChild(closingMessageDiv);
                }

                // 最初のタブをアクティブにする
                if (tabHeaders.firstElementChild) {
                    tabHeaders.firstElementChild.classList.add('active');
                    tabContents.firstElementChild.classList.add('active');
                }

                // タブ切り替えイベントリスナー
                tabHeaders.querySelectorAll('.tab-header').forEach(header => {
                    header.addEventListener('click', () => {
                        tabHeaders.querySelectorAll('.tab-header').forEach(h => h.classList.remove('active'));
                        tabContents.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

                        header.classList.add('active');
                        document.getElementById(header.dataset.tab).classList.add('active');
                        setupEventListeners(); // タブ切り替え時にイベントリスナーを再設定
                    });
                });

                // ボタンのイベントリスナーを設定 (ページごとに再設定が必要)
                setupEventListeners();

            } else {
                tabContents.innerHTML = `<p>分析結果がありませんでした。</p>`;
            }
        })
        .catch(error => {
            loadingDiv.style.display = 'none';
            tabContents.innerHTML = `<p style="color: red;">エラーが発生しました: ${error.message || error}</p>`;
            console.error('Error:', error);
        });
    });

    // イベントリスナー設定関数
    function setupEventListeners() {
        document.querySelectorAll('.adopt-btn').forEach(button => {
            button.addEventListener('click', (event) => {
                const card = event.target.closest('.suggestion-card');
                const applyInstructionsDiv = card.querySelector('.apply-instructions');
                
                // 他のカードの指示を非表示にする
                document.querySelectorAll('.apply-instructions').forEach(inst => {
                    if (inst !== applyInstructionsDiv) {
                        inst.style.display = 'none';
                    }
                });
                document.querySelectorAll('.suggestion-card').forEach(c => {
                    if (c !== card) {
                        c.style.backgroundColor = ''; // 他のカードのハイライトを解除
                    }
                });

                // 自身の指示を表示/非表示切り替え
                if (applyInstructionsDiv.style.display === 'none') {
                    applyInstructionsDiv.style.display = 'block';
                    card.style.backgroundColor = '#e6ffe6'; // 緑色にハイライト
                    console.log(`提案 ${card.dataset.index} (${card.dataset.pageUrl}) の適用指示を表示しました。`);
                } else {
                    applyInstructionsDiv.style.display = 'none';
                    card.style.backgroundColor = ''; // ハイライト解除
                    console.log(`提案 ${card.dataset.index} (${card.dataset.pageUrl}) の適用指示を非表示にしました。`);
                }
            });
        });

        document.querySelectorAll('.keep-btn').forEach(button => {
            button.addEventListener('click', (event) => {
                const card = event.target.closest('.suggestion-card');
                const applyInstructionsDiv = card.querySelector('.apply-instructions');
                applyInstructionsDiv.style.display = 'none'; // 指示を非表示
                card.style.backgroundColor = '#ffe6e6'; // 赤色にハイライト
                console.log(`提案 ${card.dataset.index} (${card.dataset.pageUrl}) をそのままにしました。`);
                // ここにそのまま時のロジックを追加
            });
        });

        document.querySelectorAll('.copy-btn').forEach(button => {
            button.addEventListener('click', (event) => {
                const targetId = event.target.dataset.target;
                const codeBlock = document.getElementById(targetId);
                if (codeBlock) {
                    navigator.clipboard.writeText(codeBlock.textContent)
                        .then(() => {
                            event.target.textContent = 'コピーしました！';
                            setTimeout(() => {
                                event.target.textContent = 'コピー';
                            }, 2000);
                        })
                        .catch(err => {
                            console.error('コピーに失敗しました:', err);
                            alert('コピーに失敗しました。手動でコピーしてください。');
                        });
                }
            });
        });

        // 「変更を適用」ボタンのイベントリスナー
        document.querySelectorAll('.apply-file-btn').forEach(button => {
            button.addEventListener('click', async (event) => {
                const index = event.target.dataset.index;
                const card = event.target.closest('.suggestion-card');
                const filePathInput = document.getElementById(`filePathInput-${index}`);
                const applyStatusDiv = document.getElementById(`apply-status-${index}`);

                const filePath = filePathInput.value;
                const originalText = card.dataset.originalText;
                const suggestedText = card.dataset.suggestedText;
                const fileTypeHint = card.dataset.fileTypeHint;

                if (!filePath) {
                    alert('ローカルファイルパスを入力してください。');
                    return;
                }
                if (!originalText || !suggestedText) {
                    alert('変更するコードが見つかりません。');
                    return;
                }

                applyStatusDiv.style.color = 'black';
                applyStatusDiv.textContent = '変更を適用中...';

                try {
                    const response = await fetch('http://127.0.0.1:8000/apply_suggestion', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            file_path: filePath,
                            original_text: originalText,
                            suggested_text: suggestedText,
                            file_type_hint: fileTypeHint // 必要であればバックエンドで利用
                        }),
                    });

                    const result = await response.json();

                    if (response.ok && result.success) {
                        applyStatusDiv.style.color = 'green';
                        applyStatusDiv.textContent = `変更が適用されました: ${result.message}`;
                        saveAdoptedSuggestion(card.dataset.suggestionId); // 採用済みとして保存
                        card.style.display = 'none'; // カードを非表示にする
                    } else {
                        applyStatusDiv.style.color = 'red';
                        applyStatusDiv.textContent = `変更の適用に失敗しました: ${result.message || '不明なエラー'}`;
                    }
                } catch (error) {
                    applyStatusDiv.style.color = 'red';
                    applyStatusDiv.textContent = `通信エラー: ${error.message || error}`;
                    console.error('Apply error:', error);
                }
            });
        });
    }

    // HTMLエスケープ関数
    function escapeHtml(text) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
});
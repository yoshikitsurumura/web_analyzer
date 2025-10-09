import os
from dotenv import load_dotenv # 追加
import google.generativeai as genai
import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse
import json
from urllib.parse import urljoin, urlparse

# .env ファイルを読み込む
load_dotenv()

# --- AIのセットアップ ---
# 環境変数からAPIキーを取得
gemini_api_key = os.environ.get("GEMINI_API_KEY")

# GEMINI_API_KEY が設定されていない場合、GOOGLE_API_KEY をフォールバックとして使用
if not gemini_api_key:
    gemini_api_key = os.environ.get("GOOGLE_API_KEY")

# どちらのAPIキーも設定されていない場合はエラーを発生させる
if not gemini_api_key:
    raise ValueError("GEMINI_API_KEY または GOOGLE_API_KEY 環境変数が設定されていません。")

# AIライブラリにAPIキーを設定します。
# これにより、コード内に直接キーを書き込むことなく、安全にAPIを利用できます。
genai.configure(api_key=gemini_api_key)

# --- FastAPIアプリのセットアップ ---
app = FastAPI()

origins = [
    "http://localhost",
    "http://localhost:8000",
    "null",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnalyzeRequest(BaseModel):
    url: str

class ApplySuggestionRequest(BaseModel):
    file_path: str
    original_text: str
    suggested_text: str
    file_type_hint: str # フロントエンドから渡されるが、ここでは直接使用しない

# --- 定数 ---
MAX_PAGES_TO_ANALYZE = 10 # 分析する最大ページ数（初期ページ含む）

# --- ヘルパー関数 ---
def get_page_content(url: str) -> str:
    """指定されたURLのHTMLコンテンツを取得し、テキストを抽出する"""
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    soup = BeautifulSoup(response.content, 'html.parser')
    return soup.get_text(separator=' ', strip=True)

def get_internal_links(html_content: str, base_url: str) -> list[str]:
    """HTMLコンテンツから同じドメインの内部リンクを抽出する"""
    soup = BeautifulSoup(html_content, 'html.parser')
    internal_links = set()
    base_netloc = urlparse(base_url).netloc

    for a_tag in soup.find_all('a', href=True):
        href = a_tag['href']
        full_url = urljoin(base_url, href)
        parsed_full_url = urlparse(full_url)

        # 同じドメインの内部リンクかつ、HTMLページへのリンクのみを対象
        if parsed_full_url.netloc == base_netloc and \
           (parsed_full_url.scheme == 'http' or parsed_full_url.scheme == 'https') and \
           not parsed_full_url.path.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.css', '.js', '.pdf')):
            internal_links.add(full_url.split('#')[0]) # フラグメントを除去
            
    return list(internal_links)

# --- 分析ロジック ---
def analyze_website_with_ai(site_html):
    """AIを使ってウェブサイトのHTMLを分析し、改善点を提案する"""
    print("AI分析を開始します...") # 追加
    model = genai.GenerativeModel('gemini-1.5-flash')
    raw_ai_response = "N/A" # AIからの生応答を事前に初期化
    
    prompt = f"""
あなたは、中小企業の経営者や個人事業主を顧客に持つ、非常に優秀なSEOコンサルタントです。
専門用語を極力使わず、誰にでも理解できる言葉で、具体的かつ実践的な改善案を提案することに長けています。

以下のウェブサイトのHTMLソースコードを分析し、次の項目について具体的な提案をしてください。
- **提案キーワード**: このサイトのビジネス内容や強みから、顧客が検索しそうなキーワードを**5つ**提案してください。
- **改善案**: 「コンテンツの魅力」と「技術的なSEO」の両面から、「明日からすぐに実行できる改善案」を**5つ**提案してください。

各改善案は、元のHTMLコードと提案するHTMLコード、その理由、そして変更が想定されるファイルの種類（HTMLが主）を明確に含めてください。

**重要:**
*   `original_text`には、ウェブサイトのソースコード（HTML）から直接コピー＆ペーストできるような、**具体的なHTMLスニペット**を記述してください。改善案が「新しい要素の追加」である場合（例：meta descriptionの追加）、`original_text`は空文字列にしてください。
*   `suggested_text`には、`original_text`を置き換えるか、新しく追加するための**具体的なHTMLスニペット**を記述してください。
*   `file_type_hint`には、この変更が適用されるべきファイルの種類を「HTML」「CSS」「JavaScript」のいずれかで記述してください（ほとんどの場合「HTML」になるはずです）。
*   `category`には、以下のいずれかを記述してください。

---
### 分析の観点

1.  **コンテンツの魅力（キャッチコピー、見出し、サービス説明）**
    *   訪問者の心をつかむ、魅力的な言葉になっているか？
    *   提供しているサービスや商品の強みが明確に伝わるか？
    *   「お問い合わせ」や「購入」など、訪問者にとってほしい行動が明確に示されているか？

2.  **技術的なSEO（検索エンジン向けの最適化）**
    *   **タイトルタグ (`<title>`)**: ページの主題が簡潔に分かりやすく記述されているか？
    *   **メタディスクリプション (`<meta name="description">`)**: 検索結果に表示されるページの説明文が設定されているか？内容は適切か？
    *   **見出しタグ (`<h1>`)**: ページで最も重要な見出しとして、適切に使われているか？（各ページに1つが理想）
    *   **画像の代替テキスト (`alt`属性)**: 画像が表示されない場合や、目の不自由な方向けのテキストが、全ての`<img>`タグに設定されているか？
    *   **OGP (Open Graph Protocol)**: SNSでシェアされた際に、意図した画像やタイトルが表示されるための設定（`og:title`, `og:description`, `og:image`など）はされているか？
    *   **構造化データ (Schema.org)**: 検索エンジンがページ内容を正確に理解するための「構造化データ」は設定されているか？もし設定されていない場合、このサイトのビジネス内容（例: 地域の店舗、オンライン記事、商品ページ等）に最も適した**JSON-LD形式の構造化データコードを生成して提案してください。** 既存の場合は、内容をレビューし改善案を提示してください。

---
### 出力形式 (JSON)

制約条件:
*   必ず5つの改善案と、5つの提案キーワードを提案してください。
*   出力は必ずJSON形式でお願いします。JSONの構造は以下の通りです。
```json
{{
  "suggested_keywords": [
    "提案キーワード1",
    "提案キーワード2",
    "提案キーワード3",
    "提案キーワード4",
    "提案キーワード5"
  ],
  "suggestions": [
    {{
      "category": "提案カテゴリ（例: 技術的なSEO, コンテンツの魅力）",
      "original_text": "ウェブサイトのソースコードからコピーできる具体的なHTMLスニペット",
      "suggested_text": "original_textを置き換えるか新しく追加するHTMLスニペット",
      "reason": "この提案の理由を、専門用語を避けて簡潔に説明",
      "file_type_hint": "HTML"
    }},
    {{
      "category": "...",
      "original_text": "...",
      "suggested_text": "...",
      "reason": "...",
      "file_type_hint": "..."
    }},
    {{
      "category": "...",
      "original_text": "...",
      "suggested_text": "...",
      "reason": "...",
      "file_type_hint": "..."
    }},
    {{
      "category": "...",
      "original_text": "...",
      "suggested_text": "...",
      "reason": "...",
      "file_type_hint": "..."
    }},
    {{
      "category": "...",
      "original_text": "...",
      "suggested_text": "...",
      "reason": "...",
      "file_type_hint": "..."
    }}
  ],
  "closing_message": "これらの改善とキーワード戦略で、より多くの人にあなたのウェブサイトが見つけてもらいやすくなります。"
}}
```
*   JSON以外の余計なテキストは一切含めないでください。
*   理由の説明では、専門用語（例：SEO, CVR, UX, CTAなど）は避け、「検索エンジンが内容を理解しやすくなる」「検索結果でクリックされやすくなる」といった平易な言葉で説明してください。

---
【分析対象のウェブサイト HTMLソースコード】
{site_html}
---
"""
    
    try:
        print("Gemini APIにリクエストを送信します...") # 追加
        response = model.generate_content(prompt)
        print("Gemini APIからの応答を受信しました。") # 追加
        raw_ai_response = response.text
        print(f"AIからの生応答: {raw_ai_response}") # デバッグ用のprint文

        # Markdownのコードブロックを削除
        json_string = raw_ai_response.replace("```json", "").replace("```", "").strip()
        
        print(f"パース前のJSON文字列: '{json_string}'") # 新しいデバッグ用print文

        # AIの応答がJSON形式であることを確認し、パースする
        return json.loads(json_string)
    except json.JSONDecodeError as e: # JSONパースエラーを specifically catch
        print(f"JSONパースエラーが発生しました: {e}") # 追加
        return {"error": f"AIによる分析中にJSONパースエラーが発生しました: {e}", "raw_response": raw_ai_response}
    except Exception as e:
        print(f"AI分析中に予期せぬエラーが発生しました: {e}") # 追加
        return {"error": f"AIによる分析中に予期せぬエラーが発生しました: {e}", "raw_response": raw_ai_response}


# --- APIエンドポイント ---
# 静的ファイルを提供するための設定
app.mount("/static", StaticFiles(directory=os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))), name="static")

@app.get("/")
async def read_root():
    return FileResponse("index.html")

@app.post("/analyze")
def analyze_website_endpoint(request: AnalyzeRequest):
    initial_url = request.url
    urls_to_analyze = [initial_url]
    analyzed_urls = set()
    pages_analysis = []
    closing_message = ""

    while urls_to_analyze and len(analyzed_urls) < MAX_PAGES_TO_ANALYZE:
        current_url = urls_to_analyze.pop(0)
        if current_url in analyzed_urls:
            continue

        analyzed_urls.add(current_url)

        try:
            # 1. URLからHTMLを取得
            print(f"ウェブサイトコンテンツの取得を開始します: {current_url}") # 追加
            response = requests.get(current_url, timeout=10)
            response.raise_for_status()
            html_content = response.text  # リンク抽出のためにHTMLコンテンツを保持
            print(f"ウェブサイトコンテンツの取得が完了しました: {current_url}") # 追加

            # HTMLコンテンツが長すぎる場合、AIが処理しやすいように短縮する
            if len(html_content) > 20000: # テキストより多くの情報を保持するため、上限を少し増やす
                html_content = html_content[:20000]

            # 3. AIによる分析を実行 (HTML全体を渡す)
            ai_response = analyze_website_with_ai(html_content)

            if "error" in ai_response:
                pages_analysis.append({
                    "url": current_url,
                    "error": ai_response["error"],
                    "raw_response": ai_response.get("raw_response", "N/A")
                })
            else:
                pages_analysis.append({
                    "url": current_url,
                    "suggestions": ai_response.get("suggestions", []),
                    "suggested_keywords": ai_response.get("suggested_keywords", []),
                    "closing_message": ai_response.get("closing_message", "")
                })
                # 最初のページのclosing_messageを全体のclosing_messageとして採用
                if current_url == initial_url:
                    closing_message = ai_response.get("closing_message", ai_response.get("closing_message", ""))

            # 4. 内部リンクを抽出し、分析キューに追加
            if len(analyzed_urls) < MAX_PAGES_TO_ANALYZE:
                found_links = get_internal_links(html_content, current_url)
                for link in found_links:
                    if link not in analyzed_urls and link not in urls_to_analyze:
                        urls_to_analyze.append(link)
                        # キューのサイズを制限
                        if len(urls_to_analyze) + len(analyzed_urls) >= MAX_PAGES_TO_ANALYZE:
                            break

        except requests.RequestException as e:
            pages_analysis.append({"url": current_url, "error": f"ウェブサイトの取得に失敗しました: {e}"})
        except Exception as e:
            pages_analysis.append({"url": current_url, "error": f"予期せぬエラーが発生しました: {e}"})

    return {
        "pages_analysis": pages_analysis,
        "closing_message": closing_message
    }

@app.post("/apply_suggestion")
async def apply_suggestion(request: ApplySuggestionRequest):
    file_path = request.file_path
    original_text = request.original_text
    suggested_text = request.suggested_text

    try:
        # ファイルの存在確認
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"ファイルが見つかりません: {file_path}")

        # ファイルを読み込む
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 置き換え対象のテキストが存在するか確認
        if original_text not in content:
            raise HTTPException(status_code=400, detail=f"ファイル内に元のテキストが見つかりません。正確なテキストをコピーしてください。")

        # テキストを置き換える
        new_content = content.replace(original_text, suggested_text, 1) # 最初の1回だけ置き換え

        # ファイルを上書き保存
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)

        return {"success": True, "message": f"ファイル '{file_path}' の変更が適用されました。"}

    except HTTPException as e:
        return {"success": False, "message": e.detail}
    except Exception as e:
        return {"success": False, "message": f"ファイルの変更中に予期せぬエラーが発生しました: {e}"}
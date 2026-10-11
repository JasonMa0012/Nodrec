#include <windows.h>
#include <d3d11.h>
#include <wrl/client.h>
#include <imgui.h>
#include <imgui_impl_win32.h>
#include <imgui_impl_dx11.h>
#include <imgui_node_editor.h>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include "graph.h"

using Microsoft::WRL::ComPtr;
namespace ed = ax::NodeEditor;
extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND, UINT, WPARAM, LPARAM);

static ComPtr<ID3D11Device> device;
static ComPtr<ID3D11DeviceContext> deviceContext;
static ComPtr<IDXGISwapChain> swapChain;
static ComPtr<ID3D11RenderTargetView> renderTarget;
static UINT pendingWidth = 0, pendingHeight = 0;
static float dpiScale = 1.0f;
static bool fontDirty = false;

static void Check(HRESULT result)
{
    if (FAILED(result))
    {
        char message[96];
        std::snprintf(message, sizeof(message), "Graphics operation failed: 0x%08lX", result);
        throw std::runtime_error(message);
    }
}

static void CreateRenderTarget()
{
    ComPtr<ID3D11Texture2D> backBuffer;
    Check(swapChain->GetBuffer(0, IID_PPV_ARGS(&backBuffer)));
    Check(device->CreateRenderTargetView(backBuffer.Get(), nullptr, &renderTarget));
}

static void SaveRenderedFrame()
{
    ComPtr<ID3D11Texture2D> backBuffer, staging;
    Check(swapChain->GetBuffer(0, IID_PPV_ARGS(&backBuffer)));
    D3D11_TEXTURE2D_DESC description;
    backBuffer->GetDesc(&description);
    description.Usage = D3D11_USAGE_STAGING;
    description.BindFlags = description.MiscFlags = 0;
    description.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    Check(device->CreateTexture2D(&description, nullptr, &staging));
    deviceContext->CopyResource(staging.Get(), backBuffer.Get());
    D3D11_MAPPED_SUBRESOURCE mapped;
    Check(deviceContext->Map(staging.Get(), 0, D3D11_MAP_READ, 0, &mapped));
    const UINT stride = description.Width * 4;
    std::vector<unsigned char> pixels(stride * description.Height);
    for (UINT y = 0; y < description.Height; ++y)
    {
        const auto* row = static_cast<const unsigned char*>(mapped.pData) + y * mapped.RowPitch;
        for (UINT x = 0; x < description.Width; ++x)
        {
            auto* pixel = pixels.data() + y * stride + x * 4;
            pixel[0] = row[x * 4 + 2];
            pixel[1] = row[x * 4 + 1];
            pixel[2] = row[x * 4];
            pixel[3] = 255;
        }
    }
    deviceContext->Unmap(staging.Get(), 0);
    BITMAPFILEHEADER fileHeader = {};
    fileHeader.bfType = 0x4d42;
    fileHeader.bfOffBits = sizeof(BITMAPFILEHEADER) + sizeof(BITMAPINFOHEADER);
    fileHeader.bfSize = fileHeader.bfOffBits + static_cast<DWORD>(pixels.size());
    BITMAPINFOHEADER info = {};
    info.biSize = sizeof(info);
    info.biWidth = description.Width;
    info.biHeight = -static_cast<LONG>(description.Height);
    info.biPlanes = 1;
    info.biBitCount = 32;
    wchar_t executablePath[MAX_PATH];
    const DWORD pathLength = GetModuleFileNameW(nullptr, executablePath, MAX_PATH);
    if (!pathLength || pathLength >= MAX_PATH) throw std::runtime_error("Cannot resolve snapshot path");
    std::wstring path(executablePath);
    path.resize(path.find_last_of(L"\\/") + 1);
    path += L"prototype-render.bmp";
    const HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) throw std::runtime_error("Cannot write rendered snapshot");
    DWORD written;
    const bool saved = WriteFile(file, &fileHeader, sizeof(fileHeader), &written, nullptr) && written == sizeof(fileHeader)
        && WriteFile(file, &info, sizeof(info), &written, nullptr) && written == sizeof(info)
        && WriteFile(file, pixels.data(), static_cast<DWORD>(pixels.size()), &written, nullptr) && written == pixels.size();
    CloseHandle(file);
    if (!saved) throw std::runtime_error("Rendered snapshot write failed");
}

static LRESULT WINAPI WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (ImGui::GetCurrentContext() && ImGui_ImplWin32_WndProcHandler(window, message, wParam, lParam))
        return 1;
    switch (message)
    {
    case WM_SIZE:
        if (wParam != SIZE_MINIMIZED) { pendingWidth = LOWORD(lParam); pendingHeight = HIWORD(lParam); }
        return 0;
    case WM_DPICHANGED:
    {
        dpiScale = HIWORD(wParam) / 96.0f;
        fontDirty = true;
        const auto* rectangle = reinterpret_cast<const RECT*>(lParam);
        SetWindowPos(window, nullptr, rectangle->left, rectangle->top,
                     rectangle->right - rectangle->left, rectangle->bottom - rectangle->top,
                     SWP_NOZORDER | SWP_NOACTIVATE);
        return 0;
    }
    case WM_DESTROY: PostQuitMessage(0); return 0;
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

static void ConfigureStyleAndFonts()
{
    ImGui::GetStyle() = ImGuiStyle();
    ImGui::StyleColorsDark();
    auto& style = ImGui::GetStyle();
    style.WindowRounding = 0;
    style.ChildRounding = 8;
    style.FrameRounding = 5;
    style.ItemSpacing = ImVec2(10, 10);
    style.WindowPadding = ImVec2(18, 18);
    style.Colors[ImGuiCol_WindowBg] = ImVec4(.065f, .075f, .095f, 1);
    style.Colors[ImGuiCol_ChildBg] = ImVec4(.10f, .115f, .14f, 1);
    style.Colors[ImGuiCol_Button] = ImVec4(.17f, .31f, .49f, 1);
    style.ScaleAllSizes(dpiScale);
    auto& io = ImGui::GetIO();
    io.Fonts->Clear();
    ImFontConfig font;
    font.SizePixels = 18 * dpiScale;
    char windowsDirectory[MAX_PATH] = {};
    GetWindowsDirectoryA(windowsDirectory, MAX_PATH);
    const std::string fontPath = std::string(windowsDirectory) + "/Fonts/segoeui.ttf";
    if (GetFileAttributesA(fontPath.c_str()) != INVALID_FILE_ATTRIBUTES)
        io.Fonts->AddFontFromFileTTF(fontPath.c_str(), font.SizePixels, &font);
    else
        io.Fonts->AddFontDefault(&font);
    const std::string chineseFont = std::string(windowsDirectory) + "/Fonts/msyh.ttc";
    if (GetFileAttributesA(chineseFont.c_str()) != INVALID_FILE_ATTRIBUTES)
    {
        font.MergeMode = true;
        font.OversampleH = font.OversampleV = 1;
        io.Fonts->AddFontFromFileTTF(chineseFont.c_str(), font.SizePixels, &font,
                                    io.Fonts->GetGlyphRangesChineseSimplifiedCommon());
    }
    fontDirty = false;
}

static ImVec4 PinColor(PinType type)
{
    switch (type)
    {
    case PinType::Video: return ImVec4(.25f, .68f, 1, 1);
    case PinType::Integer: return ImVec4(.50f, .85f, .40f, 1);
    case PinType::EncodedVideo: return ImVec4(.73f, .51f, 1, 1);
    case PinType::Path: return ImVec4(1, .70f, .27f, 1);
    }
    return ImVec4(1, 1, 1, 1);
}

static void DrawGraph(PrototypeGraph& graph, ed::EditorContext* editor, bool& initializeLayout,
                      std::string& feedback)
{
    ed::SetCurrentEditor(editor);
    ed::Begin("Workflow");
    const char* names[] = {"Capture Screen", "Frame Rate", "Encode H.264", "Output Path", "Write Video"};
    const ImVec2 positions[] = {{30, 80}, {30, 350}, {330, 80}, {330, 350}, {640, 110}};
    for (int node = 1; node <= 5; ++node)
    {
        if (initializeLayout)
            ed::SetNodePosition(ed::NodeId(node), ImVec2(positions[node - 1].x * dpiScale,
                                                      positions[node - 1].y * dpiScale));
        ed::BeginNode(ed::NodeId(node));
        ImGui::TextColored(ImVec4(.70f, .82f, 1, 1), "%s", names[node - 1]);
        ImGui::Dummy(ImVec2(180 * dpiScale, 1));
        if (node == 1) ImGui::Checkbox("Show cursor", &graph.showCursor);
        if (node == 2)
        {
            ImGui::SetNextItemWidth(180 * dpiScale);
            ImGui::SliderInt("##node-fps", &graph.fps, 10, 60);
        }
        if (node == 3) ImGui::TextDisabled("Encoder not implemented");
        if (node == 4) ImGui::TextDisabled("Edit path in left panel");
        if (node == 5) ImGui::TextDisabled("Writer not implemented");
        for (const auto& pin : graph.pins)
        {
            if (pin.node != node) continue;
            ed::BeginPin(ed::PinId(pin.id), pin.output ? ed::PinKind::Output : ed::PinKind::Input);
            ImGui::TextColored(PinColor(pin.type), pin.output ? "%s  >" : ">  %s", pin.label);
            ed::EndPin();
        }
        ed::EndNode();
    }
    for (const auto& link : graph.links)
        ed::Link(ed::LinkId(link.id), ed::PinId(link.from), ed::PinId(link.to),
                 PinColor(graph.FindPin(link.from)->type), 2.5f);
    if (ed::BeginCreate())
    {
        ed::PinId first, second;
        if (ed::QueryNewLink(&first, &second) && first && second)
        {
            // Validate a copy so dragging does not mutate the shared graph.
            auto candidate = graph;
            feedback = candidate.AddLink(static_cast<int>(first.Get()), static_cast<int>(second.Get()));
            if (feedback.empty())
            {
                if (ed::AcceptNewItem())
                {
                    graph.links = std::move(candidate.links);
                    graph.nextLink = candidate.nextLink;
                    feedback = "Link created";
                }
            }
            else ed::RejectNewItem(ImColor(230, 80, 80), 3);
        }
    }
    ed::EndCreate();
    if (ed::BeginDelete())
    {
        ed::LinkId link;
        while (ed::QueryDeletedLink(&link))
            if (ed::AcceptDeletedItem()) { graph.RemoveLink(static_cast<int>(link.Get())); feedback = "Link deleted"; }
        ed::NodeId node;
        while (ed::QueryDeletedNode(&node)) ed::RejectDeletedItem();
    }
    ed::EndDelete();
    ed::End();
    if (initializeLayout) { ed::NavigateToContent(0); initializeLayout = false; }
    ed::SetCurrentEditor(nullptr);
}

static void DrawInterface(PrototypeGraph& graph, ed::EditorContext* editor,
                          ID3D11ShaderResourceView* preview, bool& animate,
                          bool& initializeLayout, bool& showGraph, std::string& feedback)
{
    const auto* viewport = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(viewport->WorkPos);
    ImGui::SetNextWindowSize(viewport->WorkSize);
    ImGui::Begin("Nodrec", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoSavedSettings);
    ImGui::TextColored(ImVec4(.70f, .82f, 1, 1), "NODREC  /  UI ROUTE PROTOTYPE");
    ImGui::SameLine();
    ImGui::TextDisabled("Dear ImGui + imgui-node-editor");
    if (ImGui::Button("Simple Recording")) showGraph = false;
    ImGui::SameLine();
    if (ImGui::Button("Workflow Editor")) showGraph = true;
    ImGui::SameLine();
    ImGui::TextDisabled("%.0f UI fps", ImGui::GetIO().Framerate);
    ImGui::Separator();

    ImGui::BeginChild("Parameters", ImVec2(290 * dpiScale, 0), true);
    ImGui::Text("Recording settings");
    ImGui::TextDisabled("Shared by both views");
    ImGui::Spacing();
    ImGui::Text("Frame rate");
    ImGui::SetNextItemWidth(-1);
    ImGui::SliderInt("##preset-fps", &graph.fps, 10, 60, "%d fps");
    ImGui::Checkbox("Show cursor", &graph.showCursor);
    ImGui::Text("Output directory");
    ImGui::SetNextItemWidth(-1);
    ImGui::InputText("##output", graph.outputPath, sizeof(graph.outputPath));
    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Text("Preview");
    ImGui::TextDisabled("Generated test pattern");
    ImGui::Image(preview, ImVec2(250 * dpiScale, 140.625f * dpiScale));
    ImGui::Checkbox("Animate preview", &animate);
    ImGui::Spacing();
    ImGui::TextWrapped("No screen capture, input recording or video files are produced by this prototype.");
    ImGui::EndChild();
    ImGui::SameLine();
    ImGui::BeginChild("Workspace", ImVec2(0, 0), false);
    if (showGraph)
    {
        if (ImGui::Button("Fit graph"))
        {
            ed::SetCurrentEditor(editor);
            ed::NavigateToContent(.2f);
            ed::SetCurrentEditor(nullptr);
        }
        ImGui::SameLine();
        if (ImGui::Button("Restore links"))
        {
            graph.links = PrototypeGraph().links;
            feedback = "Default links restored";
        }
        ImGui::SameLine();
        ImGui::TextDisabled("Drag pins. Select a link and press Delete.");
        ImGui::TextWrapped("%s", feedback.c_str());
        DrawGraph(graph, editor, initializeLayout, feedback);
    }
    else
    {
        ImGui::Text("Simple Recording");
        ImGui::TextWrapped("Edit settings on the left, then open Workflow Editor to inspect the same parameters.");
        ImGui::Spacing();
        const float width = (std::min)(ImGui::GetContentRegionAvail().x, 750 * dpiScale);
        ImGui::Image(preview, ImVec2(width, width * 9 / 16));
        ImGui::Text("Preview cadence: %d fps", graph.fps);
    }
    ImGui::EndChild();
    ImGui::End();
}

static int RunPrototype(int argc, char** argv)
{
    if (!CheckPrototypeGraph()) { std::fprintf(stderr, "Graph self-check failed\n"); return 1; }
    if (argc > 1 && std::strcmp(argv[1], "--self-test") == 0)
    {
        std::puts("PASS: unknown pins, direction, type, self-link, duplicate input, reverse drag and deletion");
        return 0;
    }
    const bool snapshot = argc > 1 && std::strcmp(argv[1], "--snapshot") == 0;
    const bool smokeTest = snapshot || (argc > 1 && std::strcmp(argv[1], "--smoke-test") == 0);
    HWND window = nullptr;
    ed::EditorContext* editor = nullptr;
    bool win32Ready = false, dx11Ready = false;
    int result = 0;
    try
    {
        ImGui_ImplWin32_EnableDpiAwareness();
        dpiScale = ImGui_ImplWin32_GetDpiScaleForMonitor(MonitorFromPoint(POINT{100, 100}, MONITOR_DEFAULTTOPRIMARY));
        WNDCLASSW windowClass = {};
        windowClass.lpfnWndProc = WindowProc;
        windowClass.hInstance = GetModuleHandleW(nullptr);
        windowClass.lpszClassName = L"NodrecUiPrototype";
        windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        if (!RegisterClassW(&windowClass)) throw std::runtime_error("Window class registration failed");
        MONITORINFO monitor = {sizeof(MONITORINFO)};
        if (!GetMonitorInfoW(MonitorFromPoint(POINT{100, 100}, MONITOR_DEFAULTTOPRIMARY), &monitor))
            throw std::runtime_error("Cannot determine initial monitor bounds");
        const int margin = static_cast<int>(20 * dpiScale);
        const int width = (std::min<int>)(static_cast<int>(1360 * dpiScale), monitor.rcWork.right - monitor.rcWork.left - margin * 2);
        const int height = (std::min<int>)(static_cast<int>(850 * dpiScale), monitor.rcWork.bottom - monitor.rcWork.top - margin * 2);
        window = CreateWindowW(windowClass.lpszClassName, L"Nodrec - ImGui UI Prototype",
                               WS_OVERLAPPEDWINDOW, monitor.rcWork.left + margin, monitor.rcWork.top + margin, width, height,
                               nullptr, nullptr, windowClass.hInstance, nullptr);
        if (!window) throw std::runtime_error("Window creation failed");
        DXGI_SWAP_CHAIN_DESC swap = {};
        swap.BufferCount = 2;
        swap.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
        swap.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
        swap.OutputWindow = window;
        swap.SampleDesc.Count = 1;
        swap.Windowed = TRUE;
        swap.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
        Check(D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0,
                                          nullptr, 0, D3D11_SDK_VERSION, &swap, &swapChain,
                                          &device, nullptr, &deviceContext));
        CreateRenderTarget();
        IMGUI_CHECKVERSION();
        ImGui::CreateContext();
        ImGui::GetIO().IniFilename = nullptr;
        ImGui::GetIO().ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
        ConfigureStyleAndFonts();
        win32Ready = ImGui_ImplWin32_Init(window);
        dx11Ready = ImGui_ImplDX11_Init(device.Get(), deviceContext.Get());
        if (!win32Ready || !dx11Ready) throw std::runtime_error("ImGui backend initialization failed");
        ed::Config editorConfig;
        editorConfig.SettingsFile = nullptr;
        editor = ed::CreateEditor(&editorConfig);
        if (!editor) throw std::runtime_error("Node editor initialization failed");
        D3D11_TEXTURE2D_DESC textureDescription = {};
        textureDescription.Width = 256;
        textureDescription.Height = 144;
        textureDescription.MipLevels = textureDescription.ArraySize = 1;
        textureDescription.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
        textureDescription.SampleDesc.Count = 1;
        textureDescription.Usage = D3D11_USAGE_DYNAMIC;
        textureDescription.BindFlags = D3D11_BIND_SHADER_RESOURCE;
        textureDescription.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
        ComPtr<ID3D11Texture2D> previewTexture;
        ComPtr<ID3D11ShaderResourceView> previewView;
        Check(device->CreateTexture2D(&textureDescription, nullptr, &previewTexture));
        Check(device->CreateShaderResourceView(previewTexture.Get(), nullptr, &previewView));
        PrototypeGraph graph;
        bool initializeLayout = true, showGraph = true, animate = true, running = true;
        std::string feedback = "Blue: video | Green: integer | Purple: encoded video | Orange: path";
        int frameCount = 0, patternFrame = 0;
        double nextPreview = 0;
        ShowWindow(window, SW_SHOW);
        // A hidden launcher can override the first ShowWindow through STARTUPINFO.
        if (!IsWindowVisible(window)) ShowWindow(window, SW_SHOW);
        UpdateWindow(window);
        while (running)
        {
            MSG message;
            while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE))
            {
                TranslateMessage(&message);
                DispatchMessageW(&message);
                if (message.message == WM_QUIT) running = false;
            }
            if (!running) break;
            if (pendingWidth && pendingHeight)
            {
                renderTarget.Reset();
                Check(swapChain->ResizeBuffers(0, pendingWidth, pendingHeight, DXGI_FORMAT_UNKNOWN, 0));
                pendingWidth = pendingHeight = 0;
                CreateRenderTarget();
            }
            if (fontDirty)
            {
                ImGui_ImplDX11_InvalidateDeviceObjects();
                ConfigureStyleAndFonts();
            }
            ImGui_ImplDX11_NewFrame();
            ImGui_ImplWin32_NewFrame();
            ImGui::NewFrame();
            if ((animate || patternFrame == 0) && ImGui::GetTime() >= nextPreview)
            {
                D3D11_MAPPED_SUBRESOURCE mapped;
                Check(deviceContext->Map(previewTexture.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped));
                for (UINT y = 0; y < 144; ++y)
                {
                    auto* row = reinterpret_cast<unsigned char*>(mapped.pData) + y * mapped.RowPitch;
                    for (UINT x = 0; x < 256; ++x)
                    {
                        row[x * 4] = static_cast<unsigned char>((x + patternFrame * 2) % 256);
                        row[x * 4 + 1] = static_cast<unsigned char>(y * 255 / 143);
                        row[x * 4 + 2] = ((x / 16 + y / 16) % 2) ? 130 : 45;
                        row[x * 4 + 3] = 255;
                    }
                }
                deviceContext->Unmap(previewTexture.Get(), 0);
                ++patternFrame;
                const double period = 1.0 / graph.fps;
                nextPreview += period;
                if (nextPreview <= ImGui::GetTime()) nextPreview = ImGui::GetTime() + period;
            }
            DrawInterface(graph, editor, previewView.Get(), animate, initializeLayout, showGraph, feedback);
            ImGui::Render();
            const float background[] = {.065f, .075f, .095f, 1};
            auto* target = renderTarget.Get();
            deviceContext->OMSetRenderTargets(1, &target, nullptr);
            deviceContext->ClearRenderTargetView(renderTarget.Get(), background);
            ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());
            if (snapshot && frameCount == 119) SaveRenderedFrame();
            const HRESULT present = swapChain->Present(1, 0);
            Check(present);
            if (present == DXGI_STATUS_OCCLUDED) Sleep(50);
            if (++frameCount == 1)
                std::printf("READY: ImGui %s; node editor %s; Win32/DX11; DPI %.2f\n",
                            IMGUI_VERSION, IMGUI_NODE_EDITOR_VERSION, dpiScale);
            if (smokeTest && frameCount >= 120)
            {
                std::printf("PASS: rendered %d UI frames, %d texture updates, %zu links\n",
                            frameCount, patternFrame, graph.links.size());
                running = false;
            }
        }
    }
    catch (const std::exception& error)
    {
        std::fprintf(stderr, "%s\n", error.what());
        if (!smokeTest) MessageBoxA(window, error.what(), "Nodrec UI Prototype", MB_ICONERROR);
        result = 1;
    }
    if (editor) ed::DestroyEditor(editor);
    if (dx11Ready) ImGui_ImplDX11_Shutdown();
    if (win32Ready) ImGui_ImplWin32_Shutdown();
    if (ImGui::GetCurrentContext()) ImGui::DestroyContext();
    if (window && IsWindow(window)) DestroyWindow(window);
    return result;
}

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int)
{
    return RunPrototype(__argc, __argv);
}

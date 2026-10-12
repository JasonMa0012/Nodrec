#pragma once

#include "ui_state.h"
#include <imgui_node_editor.h>
#include <string>
#include <unordered_map>

class NodrecUi
{
public:
    NodrecUi();
    void Draw(ax::NodeEditor::EditorContext* editor, float dpiScale, std::string& feedback);
    void OpenBlueprintTabForSnapshot();
    void OpenCardTabForSnapshot();
    void OpenCardDetailsForSnapshot();

private:
    std::vector<PrototypeBlueprint> blueprints;
    int activeBlueprint = 0;
    int nextBlueprintId = 3;
    int undoIndex = -1;
    PrototypeBlueprint undoBlueprint;
    int graphLayoutBlueprint = -1;
    bool showNameDialog = false;
    bool namingNew = false;
    char nameBuffer[128] = {};
    std::unordered_map<std::string, bool> folderOpen;

    PrototypeBlueprint& Active();
    bool OpenFolder(const std::string& section, int index);
    void ToggleFolder(const std::string& section, int index);
    void AddFolder(const std::string& section);
    void DrawBlueprintList();
    void DrawMasterBar();
    void DrawTabs();
    void DrawOverview();
    void DrawEditor(ax::NodeEditor::EditorContext* editor, float dpiScale, std::string& feedback);
    void DrawLibrary();
    void DrawSection(const char* title, const char* sectionId, std::vector<TreeFolder>& folders, const char* itemKind, const char* itemLabel);
    void DrawParameterSection();
    void DrawGraph(ax::NodeEditor::EditorContext* editor, float dpiScale, std::string& feedback);
    void DrawCardEditor();
    void DrawDetails(ax::NodeEditor::EditorContext* editor);
    void DrawCardContents(ParameterCard& card, bool allParameters, bool editable);
    bool DrawVariable(PrototypeVariable& variable, int cardId, bool editable, bool pinned, float width);
    void ExposeVariable(int variableId, int cardId);
    void AddItem(const char* section, const char* kind);
};

bool CheckPrototypeUiState();

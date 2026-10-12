#pragma once

#include "graph.h"
#include "ui_text.h"
#include <cmath>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

enum class VariableType { Readonly, Boolean, Choice, Text };
enum class TabKind { Overview, Blueprint, Card };

struct PrototypeVariable
{
    int id = 0;
    std::string name;
    std::string key;
    std::string label;
    std::string value;
    std::vector<std::string> options;
    VariableType type = VariableType::Text;
};

struct LayoutColumn { int variable = 0; float weight = 1; };
struct LayoutRow { bool pinned = true; std::vector<LayoutColumn> columns; };
struct ParameterCard
{
    int id = 0;
    std::string name;
    std::vector<int> variables;
    std::vector<LayoutRow> rows;
};
struct TreeFolder { std::string name; std::vector<int> items; };
struct EditorTab { TabKind kind = TabKind::Overview; int card = 0; };
struct EditorSelection
{
    std::string kind = "node";
    int id = 2;
    int card = 0;
    std::string folderKind;
    int folder = -1;
};

struct PrototypeBlueprint
{
    int id = 0;
    std::string name;
    bool replayPreset = false;
    PrototypeGraph graph;
    std::vector<PrototypeVariable> variables;
    std::vector<ParameterCard> cards;
    std::vector<TreeFolder> eventFolders;
    std::vector<TreeFolder> functionFolders;
    std::vector<TreeFolder> variableFolders;
    std::vector<EditorTab> tabs{{TabKind::Overview, 0}};
    int activeTab = 0;
    EditorSelection selection;
    int detailCard = 0;
    int nextVariable = 1000;
    int nextCard = 100;
    bool screenRecording = false;
    bool screenPaused = false;
    bool audioRecording = false;
    bool audioPaused = false;
    std::vector<std::pair<int, std::string>> events{{100,UiText::OnSelectRegion},{101,UiText::OnStartRecording},{102,UiText::OnPauseRecording},{103,UiText::OnStopRecording},{104,UiText::OnRecordingFrame}};
    std::vector<std::pair<int, std::string>> functions{{200,UiText::PrepareOutputPath}};
    int fps = 60;
    bool showCursor = true;
    std::string outputFolder = "C:/Recordings";

    PrototypeVariable* FindVariable(int id)
    {
        for (auto& v : variables) if (v.id == id) return &v;
        return nullptr;
    }
    ParameterCard* FindCard(int id)
    {
        for (auto& c : cards) if (c.id == id) return &c;
        return nullptr;
    }
    EditorTab* ActiveTab()
    {
        if (activeTab < 0 || activeTab >= static_cast<int>(tabs.size())) return nullptr;
        return &tabs[activeTab];
    }
    const EditorTab* ActiveTab() const
    {
        if (activeTab < 0 || activeTab >= static_cast<int>(tabs.size())) return nullptr;
        return &tabs[activeTab];
    }
};

inline PrototypeVariable MakeVariable(int id, const char* key, const char* label, const char* value, VariableType type,
                                      std::vector<std::string> options = {})
{
    return {id, key, key, label, value, std::move(options), type};
}

inline PrototypeBlueprint MakeBlueprint(int id, const char* name, bool replay)
{
    PrototypeBlueprint b;
    b.id = id; b.name = name; b.replayPreset = replay;
    b.variables = {
        MakeVariable(1,"DisplayId",UiText::Display,UiText::DisplayResolution,VariableType::Readonly),
        MakeVariable(2,"ScreenRegion",UiText::Region,UiText::RegionValue,VariableType::Readonly),
        MakeVariable(3,"ShowCursor",UiText::ShowCursor,"true",VariableType::Boolean),
        MakeVariable(4,"StartDelay",UiText::StartDelay,"0",VariableType::Choice,{"0","3","5"}),
        MakeVariable(5,"Resolution",UiText::Resolution,"1920 × 1080",VariableType::Choice,{UiText::SourceSize,"1920 × 1080","2560 × 1440","3840 × 2160"}),
        MakeVariable(6,"FrameRate",UiText::FrameRate,"60",VariableType::Choice,{"24","30","60","120"}),
        MakeVariable(7,"Encoder",UiText::Encoder,UiText::H264,VariableType::Choice,{UiText::H264,UiText::Hevc,UiText::Av1}),
        MakeVariable(8,"Bitrate",UiText::Bitrate,"20",VariableType::Text),
        MakeVariable(9,"SystemAudio",UiText::SystemAudio,"true",VariableType::Boolean),
        MakeVariable(10,"Microphone",UiText::Microphone,"false",VariableType::Boolean),
        MakeVariable(11,"AudioDevice",UiText::Device,UiText::SystemDefault,VariableType::Choice,{UiText::SystemDefault,UiText::Headphones}),
        MakeVariable(12,"AudioSampleRate",UiText::SampleRate,"48 kHz",VariableType::Choice,{"48 kHz","44.1 kHz"}),
        MakeVariable(13,"OutputFolder",UiText::OutputFolder,"C:/Recordings",VariableType::Text),
        MakeVariable(14,"FileNamePattern",UiText::FilenamePattern,"{blueprint}_{timestamp}",VariableType::Text),
        MakeVariable(15,"PointerMode",UiText::PointerMode,UiText::SemanticPointer,VariableType::Choice,{UiText::SemanticPointer,UiText::AbsoluteCoordinates}),
        MakeVariable(16,"RecordKeyboard",UiText::KeyboardInput,"true",VariableType::Boolean),
        MakeVariable(17,"RecordMouse",UiText::MouseInput,"true",VariableType::Boolean),
        MakeVariable(18,"PixelThreshold",UiText::PixelThreshold,UiText::LowTolerance,VariableType::Choice,{UiText::Exact,UiText::LowTolerance,UiText::MediumTolerance})
    };
    b.nextVariable = 19;
    auto card = [&b](int cid, const char* name, std::vector<int> vars, std::vector<int> pinned)
    {
        ParameterCard c; c.id=cid; c.name=name; c.variables=vars;
        for(int v:vars){const bool pin=std::find(pinned.begin(),pinned.end(),v)!=pinned.end();c.rows.push_back({pin,{{v,1}}});}
        b.cards.push_back(std::move(c));
    };
    card(1,UiText::RecordingSettings,{1,2,3,4},{1,2,3});
    card(2,UiText::Video,{5,6,7,8},{5,6});
    card(3,UiText::Audio,{9,10,11,12},{9,10});
    card(4,UiText::Output,{13,14},{13});
    if(replay){card(5,UiText::InputRecording,{15,16,17},{15,16,17});card(6,UiText::ReplayVerification,{18},{18});}
    b.eventFolders={ {UiText::Recording,{100,101,102,103}} };
    b.functionFolders={ {UiText::Utilities,{200}} };
    b.variableFolders={ {UiText::CaptureFolder,{1,2,3,4}}, {UiText::VideoFolder,{5,6,7,8}}, {UiText::AudioFolder,{9,10,11,12}}, {UiText::OutputGroup,{13,14}} };
    if(replay)b.variableFolders.push_back({UiText::Input,{15,16,17,18}});
    return b;
}

inline void NormalizeCard(ParameterCard& card)
{
    std::vector<LayoutRow> normalized;
    for(bool pinned:{true,false})
    {
        for(auto& row:card.rows)
        {
            LayoutRow filtered; filtered.pinned=pinned;
            for(auto col:row.columns)
                if(row.pinned==pinned && std::find(card.variables.begin(),card.variables.end(),col.variable)!=card.variables.end())
                    filtered.columns.push_back(col);
            if(!filtered.columns.empty()) normalized.push_back(std::move(filtered));
        }
    }
    for(int v:card.variables)
    {
        bool exists=false;for(const auto& r:normalized)for(const auto& c:r.columns)exists|=c.variable==v;
        if(!exists)normalized.push_back({false,{{v,1}}});
    }
    card.rows=std::move(normalized);
}

inline bool ExposeParameter(ParameterCard& card,int variable)
{
    if(std::find(card.variables.begin(),card.variables.end(),variable)!=card.variables.end())return false;
    card.variables.push_back(variable);
    card.rows.push_back({false,{{variable,1}}});
    NormalizeCard(card);
    return true;
}

inline bool SetParameterPinned(ParameterCard& card, int variable, bool pinned)
{
    bool found=false;
    for(auto& row:card.rows)for(auto it=row.columns.begin();it!=row.columns.end();)
        if(it->variable==variable){found=true;if(row.pinned!=pinned)it=row.columns.erase(it);else ++it;}else ++it;
    card.rows.erase(std::remove_if(card.rows.begin(),card.rows.end(),[](const LayoutRow& r){return r.columns.empty();}),card.rows.end());
    if(!found)return false;
    bool already=false;for(const auto& row:card.rows)for(const auto& col:row.columns)already|=col.variable==variable;
    if(!already)card.rows.push_back({pinned,{{variable,1}}});
    NormalizeCard(card);return true;
}

inline bool MoveParameter(ParameterCard& card, int variable, int target, const char* side, bool destinationPinned)
{
    if(variable==target)return false;
    LayoutColumn moving{variable,1};bool found=false;
    for(auto& row:card.rows)for(auto it=row.columns.begin();it!=row.columns.end();)
        if(it->variable==variable){moving=*it;found=true;it=row.columns.erase(it);}else ++it;
    card.rows.erase(std::remove_if(card.rows.begin(),card.rows.end(),[](const LayoutRow& r){return r.columns.empty();}),card.rows.end());
    if(!found)return false;
    auto dest=card.rows.end();std::size_t column=0;
    if(target)for(auto it=card.rows.begin();it!=card.rows.end();++it)
        for(std::size_t i=0;i<it->columns.size();++i)if(it->columns[i].variable==target){dest=it;column=i;destinationPinned=it->pinned;break;}
    if(dest==card.rows.end())card.rows.push_back({destinationPinned,{moving}});
    else if(std::strcmp(side,"left")==0 || std::strcmp(side,"right")==0){dest->columns.insert(dest->columns.begin()+column+(std::strcmp(side,"right")==0),moving);}
    else {const auto index=static_cast<std::size_t>(dest-card.rows.begin())+(std::strcmp(side,"below")==0);card.rows.insert(card.rows.begin()+index,{destinationPinned,{moving}});}
    NormalizeCard(card);return true;
}

inline bool SetColumnWeight(LayoutRow& row,int variable,float percent)
{
    if(row.columns.size()<2)return false;
    auto selected=std::find_if(row.columns.begin(),row.columns.end(),[variable](const LayoutColumn& c){return c.variable==variable;});
    if(selected==row.columns.end())return false;
    float other=0;for(auto it=row.columns.begin();it!=row.columns.end();++it)if(it!=selected)other+=it->weight;
    if(other<=0)return false;
    const float weight=(std::max)(.1f,(std::min)(.9f,percent/100.0f));selected->weight=weight;
    for(auto it=row.columns.begin();it!=row.columns.end();++it)if(it!=selected)it->weight=(1-weight)*it->weight/other;
    return true;
}

inline bool CheckPrototypeUiState()
{
    auto a=MakeBlueprint(1,"A",true), b=MakeBlueprint(2,"B",false);
    a.tabs.push_back({TabKind::Card,1});a.activeTab=1;a.selection={"parameter",2,1};
    if(b.tabs.size()!=1||b.activeTab!=0||b.selection.kind=="parameter")return false;
    auto* card=a.FindCard(1);if(!card)return false;
    if(!ExposeParameter(*card,8)||ExposeParameter(*card,8))return false;
    if(card->rows.back().pinned||card->rows.back().columns.size()!=1||card->rows.back().columns.front().variable!=8)return false;
    if(!MoveParameter(*card,2,1,"right",true))return false;
    if(card->rows.front().columns.size()!=2||card->rows.front().columns[1].variable!=2)return false;
    if(!SetColumnWeight(card->rows.front(),2,65))return false;
    if(std::abs(card->rows.front().columns[0].weight-.35f)>.001f||std::abs(card->rows.front().columns[1].weight-.65f)>.001f)return false;
    if(!MoveParameter(*card,2,1,"left",true)||card->rows.front().columns[0].variable!=2)return false;
    if(!MoveParameter(*card,3,1,"below",true))return false;
    int rowOfOne=-1,rowOfThree=-1;
    for(std::size_t i=0;i<card->rows.size();++i)for(const auto& col:card->rows[i].columns)
    {if(col.variable==1)rowOfOne=static_cast<int>(i);if(col.variable==3)rowOfThree=static_cast<int>(i);}
    if(rowOfOne<0||rowOfThree<=rowOfOne)return false;
    if(!SetParameterPinned(*card,2,false))return false;
    if(card->rows.back().columns.size()!=1 || card->rows.back().columns.front().variable!=2)return false;
    NormalizeCard(*card);NormalizeCard(*card);
    if(a.cards.size()!=6 || b.cards.size()!=4 || b.FindCard(1)->rows.front().columns.size()!=1)return false;
    bool pinMoved=false;for(const auto& row:card->rows)for(const auto& col:row.columns)if(col.variable==2)pinMoved=!row.pinned&&std::abs(col.weight-1.0f)<.001f;
    if(!pinMoved)return false;
    auto copy=a;auto* copyCard=copy.FindCard(1);if(!copyCard||!SetParameterPinned(*copyCard,1,false))return false;
    for(const auto& row:card->rows)for(const auto& col:row.columns)if(col.variable==1)return row.pinned;
    return false;
}

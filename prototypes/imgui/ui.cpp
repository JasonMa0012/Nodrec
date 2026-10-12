#include "ui.h"
#include "blueprint_node_builder.h"
#include <imgui.h>
#include <imgui_internal.h>
#include <algorithm>
#include <cstdio>
#include <cstring>

namespace ed = ax::NodeEditor;
namespace util = ax::NodeEditor::Utilities;

static float S(float value, float dpi) { return value * dpi; }
static float ParameterTileHeight()
{
    const auto& style=ImGui::GetStyle();
    return ImGui::GetFrameHeight()*2.5f+style.ItemSpacing.y+style.WindowPadding.y*2+2.0f;
}
static bool DrawPinButton(const char* id,bool pinned)
{
    ImGui::PushID(id);
    const bool clicked=ImGui::InvisibleButton("##pin",ImVec2(24,24));
    const ImVec2 min=ImGui::GetItemRectMin(),max=ImGui::GetItemRectMax();
    const ImVec2 head((min.x+max.x)*.5f,(min.y+max.y)*.5f-4);
    const ImU32 color=ImGui::GetColorU32(ImGui::IsItemHovered()?ImGuiCol_Text:pinned?ImGuiCol_ButtonHovered:ImGuiCol_TextDisabled);
    ImDrawList* draw=ImGui::GetWindowDrawList();
    if(pinned)draw->AddCircleFilled(head,4,color);
    else draw->AddCircle(head,4,color,12,1.5f);
    draw->AddLine(ImVec2(head.x,head.y+3),ImVec2(head.x-4,head.y+10),color,1.5f);
    draw->AddLine(ImVec2(head.x-4,head.y+10),ImVec2(head.x+3,head.y+10),color,1.5f);
    if(ImGui::IsItemHovered()){ImGui::BeginTooltip();ImGui::TextUnformatted(pinned?UiText::Pinned:UiText::Pin);ImGui::EndTooltip();}
    ImGui::PopID();
    return clicked;
}
static ImVec4 PinColor(PinType t)
{
    switch (t)
    {
    case PinType::Flow:return ImVec4(.9f,.9f,.9f,1);
    case PinType::Video:return ImVec4(.25f,.68f,1,1);
    case PinType::Audio:return ImVec4(.38f,.82f,.62f,1);
    case PinType::Integer:return ImVec4(.50f,.85f,.40f,1);
    case PinType::Rect:return ImVec4(.25f,.75f,.85f,1);
    case PinType::EncodedVideo:return ImVec4(.73f,.51f,1,1);
    case PinType::Path:return ImVec4(1,.70f,.27f,1);
    case PinType::Text:return ImVec4(.95f,.75f,.35f,1);
    }
    return ImVec4(1,1,1,1);
}
static const char* KindLabel(NodeKind k)
{
    switch(k){case NodeKind::StartEvent:return UiText::Event;case NodeKind::SelectRegion:return UiText::Capture;case NodeKind::CaptureScreen:return UiText::Capture;case NodeKind::CaptureAudio:return UiText::Capture;case NodeKind::Encode:return UiText::Media;case NodeKind::Write:return UiText::Output;case NodeKind::TextNode:return UiText::Utility;}return UiText::Node;
}
static int ItemName(const PrototypeBlueprint& b, const char* section, int id, char* out, size_t cap)
{
    if(std::strcmp(section,"events")==0)
        for(const auto& item:b.events)if(item.first==id){std::snprintf(out,cap,"%s",item.second.c_str());return 1;}
    if(std::strcmp(section,"functions")==0)
        for(const auto& item:b.functions)if(item.first==id){std::snprintf(out,cap,"%s",item.second.c_str());return 1;}
    if(std::strcmp(section,"variables")==0)
        for(const auto& variable:b.variables)if(variable.id==id){std::snprintf(out,cap,"%s",variable.name.c_str());return 1;}
    return 0;
}
static LayoutRow* FindRow(ParameterCard& card,int variable)
{for(auto& row:card.rows)for(auto& col:row.columns)if(col.variable==variable)return &row;return nullptr;}

NodrecUi::NodrecUi()
{
    blueprints.push_back(MakeBlueprint(1,UiText::ScreenRecording,false));
    blueprints.push_back(MakeBlueprint(2,UiText::RecordAndReplay,true));
}
void NodrecUi::OpenBlueprintTabForSnapshot()
{auto& b=blueprints.front();b.tabs={{TabKind::Blueprint,0},{TabKind::Overview,0}};b.activeTab=0;}
void NodrecUi::OpenCardTabForSnapshot()
{auto& b=blueprints.front();b.tabs={{TabKind::Overview,0},{TabKind::Card,1}};b.activeTab=1;b.selection={"parameter",1,1};}
void NodrecUi::OpenCardDetailsForSnapshot()
{auto& b=blueprints.front();b.detailCard=1;}
PrototypeBlueprint& NodrecUi::Active(){return blueprints[activeBlueprint];}
static void OpenEditorTab(PrototypeBlueprint& blueprint,TabKind kind,int card=0)
{
    for(std::size_t i=0;i<blueprint.tabs.size();++i)
        if(blueprint.tabs[i].kind==kind&&blueprint.tabs[i].card==card){blueprint.activeTab=static_cast<int>(i);return;}
    blueprint.tabs.push_back({kind,card});blueprint.activeTab=static_cast<int>(blueprint.tabs.size()-1);
}
bool NodrecUi::OpenFolder(const std::string& section,int index)
{
    const std::string key=std::to_string(Active().id)+":"+section+":"+std::to_string(index);
    auto it=folderOpen.find(key);return it==folderOpen.end()?index==0:it->second;
}
void NodrecUi::ToggleFolder(const std::string& section,int index)
{const std::string key=std::to_string(Active().id)+":"+section+":"+std::to_string(index);folderOpen[key]=!OpenFolder(section,index);}

void NodrecUi::DrawBlueprintList()
{
    ImGui::TextDisabled(UiText::Blueprints);ImGui::Spacing();
    for(std::size_t i=0;i<blueprints.size();++i)
    {
        auto& bp=blueprints[i];ImGui::PushID(bp.id);
        ImGui::PushStyleColor(ImGuiCol_Button,i==static_cast<std::size_t>(activeBlueprint)?ImVec4(.18f,.31f,.48f,1):ImVec4(0,0,0,0));
        ImGui::BeginGroup();
        if(ImGui::Button(bp.name.c_str(),ImVec2(-104,S(60,1))))activeBlueprint=static_cast<int>(i);
        ImGui::SameLine();
        if(ImGui::SmallButton(UiText::Edit)){activeBlueprint=static_cast<int>(i);OpenEditorTab(Active(),TabKind::Blueprint);}
        ImGui::SameLine();
        if(ImGui::SmallButton(UiText::More))ImGui::OpenPopup("BlueprintActions");
        if(ImGui::BeginPopup("BlueprintActions"))
        {
            if(ImGui::MenuItem(UiText::EditBlueprint)){activeBlueprint=static_cast<int>(i);OpenEditorTab(Active(),TabKind::Blueprint);}
            if(ImGui::MenuItem(UiText::Rename)){activeBlueprint=static_cast<int>(i);std::snprintf(nameBuffer,sizeof(nameBuffer),"%s",bp.name.c_str());namingNew=false;showNameDialog=true;}
            if(ImGui::MenuItem(UiText::Duplicate)){auto copy=bp;copy.id=nextBlueprintId++;copy.name+=UiText::CopySuffix;blueprints.push_back(std::move(copy));activeBlueprint=static_cast<int>(blueprints.size()-1);}
            if(ImGui::MenuItem(UiText::Delete,nullptr,false,blueprints.size()>1)){undoBlueprint=bp;undoIndex=static_cast<int>(i);blueprints.erase(blueprints.begin()+i);activeBlueprint=(std::min)(activeBlueprint,static_cast<int>(blueprints.size()-1));Active().detailCard=0;}
            ImGui::EndPopup();
        }
        ImGui::EndGroup();ImGui::PopStyleColor();ImGui::PopID();
    }
    ImGui::Spacing();
    if(ImGui::Button(UiText::NewBlueprint,ImVec2(-1,0)))
    {std::snprintf(nameBuffer,sizeof(nameBuffer),"%s",UiText::NewBlueprintName);namingNew=true;showNameDialog=true;}
    if(undoIndex>=0&&ImGui::Button(UiText::UndoDelete,ImVec2(-1,0)))
    {blueprints.insert(blueprints.begin()+(std::min)(undoIndex,static_cast<int>(blueprints.size())),undoBlueprint);activeBlueprint=undoIndex;undoIndex=-1;}
    if(showNameDialog)
    {
        ImGui::OpenPopup(UiText::BlueprintName);
        if(ImGui::BeginPopupModal(UiText::BlueprintName,nullptr,ImGuiWindowFlags_AlwaysAutoResize))
        {
            ImGui::InputText(UiText::Name,nameBuffer,sizeof(nameBuffer));
            if(ImGui::Button(UiText::Save))
            {
                if(nameBuffer[0]){if(namingNew){auto b=MakeBlueprint(nextBlueprintId++,nameBuffer,false);blueprints.push_back(std::move(b));activeBlueprint=static_cast<int>(blueprints.size()-1);}else Active().name=nameBuffer;}
                showNameDialog=false;ImGui::CloseCurrentPopup();
            }
            ImGui::SameLine();if(ImGui::Button(UiText::Cancel)){showNameDialog=false;ImGui::CloseCurrentPopup();}
            ImGui::EndPopup();
        }
    }
}

void NodrecUi::DrawMasterBar()
{
    auto& b=Active();
    if(ImGui::Button(UiText::SelectRegion)){} ImGui::SameLine();
    if(ImGui::Button(UiText::StartRecording)){b.screenRecording=b.audioRecording=true;b.screenPaused=b.audioPaused=false;}
    ImGui::SameLine();
    const bool active=b.screenRecording||b.audioRecording;
    ImGui::BeginDisabled(!active);
    if(ImGui::Button((b.screenPaused&&b.audioPaused)?UiText::Resume:UiText::Pause))
    {if(b.screenRecording)b.screenPaused=!b.screenPaused;if(b.audioRecording)b.audioPaused=!b.audioPaused;}
    ImGui::SameLine();
    if(ImGui::Button(UiText::Stop)){b.screenRecording=b.audioRecording=false;b.screenPaused=b.audioPaused=false;}
    ImGui::EndDisabled();
    const char* screenStatus=b.screenRecording?(b.screenPaused?UiText::Paused:UiText::RecordingStatus):UiText::Ready;
    const char* audioStatus=b.audioRecording?(b.audioPaused?UiText::Paused:UiText::RecordingStatus):UiText::Ready;
    char status[96];std::snprintf(status,sizeof(status),UiText::MasterStatus,screenStatus,audioStatus);
    ImGui::SameLine();
    const float statusX=ImGui::GetWindowWidth()-ImGui::GetStyle().WindowPadding.x-ImGui::CalcTextSize(status).x;
    if(statusX>ImGui::GetCursorPosX())ImGui::SetCursorPosX(statusX);else ImGui::NewLine();
    ImGui::TextDisabled("%s",status);
    ImGui::Separator();
}

void NodrecUi::DrawTabs()
{
    auto& b=Active();
    if(!ImGui::BeginTabBar("BlueprintTabs",ImGuiTabBarFlags_Reorderable))return;
    for(std::size_t i=0;i<b.tabs.size();)
    {
        auto& tab=b.tabs[i];std::string title=tab.kind==TabKind::Overview?UiText::Overview:tab.kind==TabKind::Blueprint?UiText::Blueprint:UiText::Card;
        if(tab.kind==TabKind::Card){if(auto* c=b.FindCard(tab.card))title=c->name;}
        ImGui::PushID(b.id);ImGui::PushID(static_cast<int>(tab.kind));ImGui::PushID(tab.card);
        bool open=true;ImGuiTabItemFlags flags=tab.kind==TabKind::Overview?ImGuiTabItemFlags_NoCloseButton:ImGuiTabItemFlags_None;
        if(static_cast<int>(i)==b.activeTab)flags|=ImGuiTabItemFlags_SetSelected;
        const bool visible=ImGui::BeginTabItem(title.c_str(),&open,flags);
        if(ImGui::IsItemHovered()&&ImGui::IsMouseClicked(0))b.activeTab=static_cast<int>(i);
        if(visible)ImGui::EndTabItem();
        ImGui::PopID();ImGui::PopID();ImGui::PopID();
        if(!open){b.tabs.erase(b.tabs.begin()+i);if(b.activeTab>=static_cast<int>(i))b.activeTab=(std::max)(0,b.activeTab-1);if(b.tabs.empty())b.tabs.push_back({TabKind::Overview,0});}
        else ++i;
    }
    ImGui::EndTabBar();
}

bool NodrecUi::DrawVariable(PrototypeVariable& v,int cardId,bool editable,bool pinned,float width)
{
    const ImGuiStyle& style=ImGui::GetStyle();
    const float frameHeight=ImGui::GetFrameHeight();
    const float cardHeight=ParameterTileHeight();
    ImGui::PushID(v.id);
    ImGui::BeginChild("##parameter-card",ImVec2(width,cardHeight),true,ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoScrollWithMouse|ImGuiWindowFlags_NoSavedSettings);
    bool togglePin=false;
    const auto& selection=Active().selection;
    const bool selected=selection.kind=="parameter"&&selection.id==v.id&&selection.card==cardId;
    const float headerY=ImGui::GetCursorPosY();
    if(editable)
    {
        const ImVec2 handleSize(ImGui::CalcTextSize(UiText::ParameterDragHandle).x+style.FramePadding.x*2,ImGui::GetFrameHeight());
        ImGui::Button(UiText::ParameterDragHandle,handleSize);
        if(ImGui::BeginDragDropSource())
        {
            const int payload[2]={cardId,v.id};
            ImGui::SetDragDropPayload("NODREC_PARAMETER",payload,sizeof(payload));
            ImGui::TextUnformatted(UiText::MoveParameter);
            ImGui::EndDragDropSource();
        }
        ImGui::SameLine();
        const float labelWidth=(std::max)(S(32,1),ImGui::GetContentRegionAvail().x-S(24,1)-ImGui::GetStyle().ItemSpacing.x);
        if(ImGui::Selectable(v.label.c_str(),selected,ImGuiSelectableFlags_AllowItemOverlap,ImVec2(labelWidth,frameHeight)))
            Active().selection={"parameter",v.id,cardId};
        ImGui::SameLine();togglePin=DrawPinButton("pin",pinned);
        ImGui::SetCursorPosY(headerY+frameHeight+style.ItemSpacing.y);
        ImGui::SetCursorPosX(style.WindowPadding.x);
    }
    else ImGui::TextUnformatted(v.label.c_str());
    ImGui::SetNextItemWidth(-1);
    if(v.type==VariableType::Readonly)
    {
        ImGui::PushTextWrapPos(ImGui::GetCursorScreenPos().x+ImGui::GetContentRegionAvail().x);
        ImGui::TextWrapped("%s",v.value.c_str());
        ImGui::PopTextWrapPos();
    }
    else if(v.type==VariableType::Boolean){bool value=v.value=="true";if(ImGui::Checkbox("##value",&value))v.value=value?"true":"false";}
    else if(v.type==VariableType::Choice)
    {
        if(ImGui::BeginCombo("##value",v.value.c_str())){for(const auto& option:v.options)if(ImGui::Selectable(option.c_str(),option==v.value))v.value=option;ImGui::EndCombo();}
    }
    else {char text[256];std::snprintf(text,sizeof(text),"%s",v.value.c_str());if(ImGui::InputText("##value",text,sizeof(text)))v.value=text;}
    ImGui::EndChild();ImGui::PopID();
    return togglePin;
}

void NodrecUi::DrawCardContents(ParameterCard& c,bool allParameters,bool editable)
{
    NormalizeCard(c);
    int toggleVariable=0,moveVariable=0,moveTarget=0,exposeVariable=0,exposeTarget=0;
    bool pinDestination=false,moveDestination=false,exposePinned=false;
    const char* moveSide="below";
    for(bool pinned:{true,false})
    {
        if(!pinned&&allParameters){ImGui::Separator();ImGui::TextDisabled(UiText::NotPinned);}
        if(!pinned&&!allParameters)continue;
        for(std::size_t ri=0;ri<c.rows.size();++ri)
        {
            auto& row=c.rows[ri];if(row.pinned!=pinned)continue;
            if(row.columns.empty())continue;
            ImGui::PushID(c.id*100+static_cast<int>(ri));
            const float totalWidth=ImGui::GetContentRegionAvail().x;
            float sum=0;for(const auto& col:row.columns)sum+=col.weight;
            const int count=static_cast<int>(row.columns.size());
            const float gap=S(8,1);
            const bool stacked=totalWidth<S(190.0f*count+8.0f*(count-1),1);
            const float content=stacked?totalWidth:totalWidth-gap*(count-1);
            for(int ci=0;ci<count;++ci)
            {
                auto& col=row.columns[ci];
                const float w=stacked?totalWidth:(std::max)(S(80,1),content*col.weight/(std::max)(sum,.001f));
                if(ci>0&&stacked)ImGui::NewLine();
                if(ci>0&&!stacked)
                {
                    ImGui::SameLine(0,0);ImGui::PushID(ci);
                    ImGui::InvisibleButton("##columnResize",ImVec2(gap,S(55,1)));
                    if(ImGui::IsItemActive())
                    {
                        const float pair=row.columns[ci-1].weight+row.columns[ci].weight;
                        const float delta=ImGui::GetIO().MouseDelta.x/content*sum;
                        const float left=(std::max)(pair*.1f,(std::min)(pair*.9f,row.columns[ci-1].weight+delta));
                        row.columns[ci-1].weight=left;row.columns[ci].weight=pair-left;
                    }
                    if(ImGui::IsItemHovered())ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
                    ImGui::PopID();ImGui::SameLine(0,0);
                }
                ImGui::PushID(ci);
                if(auto* v=Active().FindVariable(col.variable))
                    if(DrawVariable(*v,c.id,editable,pinned,w)){toggleVariable=col.variable;pinDestination=!pinned;}
                const auto min=ImGui::GetItemRectMin(),max=ImGui::GetItemRectMax();
                if(editable&&ImGui::BeginDragDropTarget())
                {
                    if(const ImGuiPayload* payload=ImGui::AcceptDragDropPayload("NODREC_PARAMETER"))
                    {
                        const int* data=static_cast<const int*>(payload->Data);if(payload->IsDelivery()&&data[0]==c.id)
                        {
                            const float mx=ImGui::GetIO().MousePos.x,my=ImGui::GetIO().MousePos.y;
                            const char* side=stacked?((my<min.y+(max.y-min.y)*.5f)?"above":"below"):(mx<min.x+(max.x-min.x)*.23f)?"left":(mx>max.x-(max.x-min.x)*.23f)?"right":(my<min.y+(max.y-min.y)*.25f)?"above":"below";
                            moveVariable=data[1];moveTarget=col.variable;moveSide=side;moveDestination=pinned;
                        }
                    }
                    if(const ImGuiPayload* payload=ImGui::AcceptDragDropPayload("NODREC_VARIABLE"))
                    {
                        const int variable=*static_cast<const int*>(payload->Data);
                        if(payload->IsDelivery()&&std::find(c.variables.begin(),c.variables.end(),variable)==c.variables.end())
                        {
                            exposeVariable=variable;exposeTarget=col.variable;
                            const float mx=ImGui::GetIO().MousePos.x,my=ImGui::GetIO().MousePos.y;
                            moveSide=stacked?((my<min.y+(max.y-min.y)*.5f)?"above":"below"):(mx<min.x+(max.x-min.x)*.23f)?"left":(mx>max.x-(max.x-min.x)*.23f)?"right":(my<min.y+(max.y-min.y)*.25f)?"above":"below";
                            moveDestination=pinned;
                        }
                    }
                    ImGui::EndDragDropTarget();
                }
                ImGui::PopID();
                if(ci+1<count&&!stacked)ImGui::SameLine(0,gap);
            }
            ImGui::Spacing();ImGui::PopID();
        }
        if(editable&&allParameters)
        {
            ImGui::PushID(pinned?1:0);
            const char* hint=pinned?UiText::DropToPin:UiText::DropToUnpin;
            const ImGuiStyle& style=ImGui::GetStyle();
            ImGui::InvisibleButton("##parameter-drop-zone",ImVec2(-1,ImGui::GetFrameHeightWithSpacing()));
            const ImVec2 min=ImGui::GetItemRectMin(),max=ImGui::GetItemRectMax();
            const bool hovered=ImGui::IsItemHovered();
            ImDrawList* draw=ImGui::GetWindowDrawList();
            draw->AddRectFilled(min,max,ImGui::GetColorU32(hovered?ImGuiCol_FrameBgHovered:ImGuiCol_FrameBg),style.FrameRounding);
            draw->AddRect(min,max,ImGui::GetColorU32(ImGuiCol_Border),style.FrameRounding);
            draw->AddText(ImVec2(min.x+style.FramePadding.x,min.y+style.FramePadding.y),ImGui::GetColorU32(ImGuiCol_TextDisabled),hint);
            if(ImGui::BeginDragDropTarget())
            {
                if(const ImGuiPayload* payload=ImGui::AcceptDragDropPayload("NODREC_PARAMETER"))
                {const int* data=static_cast<const int*>(payload->Data);if(payload->IsDelivery()&&data[0]==c.id){moveVariable=data[1];moveTarget=0;moveSide="below";moveDestination=pinned;}}
                if(const ImGuiPayload* payload=ImGui::AcceptDragDropPayload("NODREC_VARIABLE"))
                {
                    const int variable=*static_cast<const int*>(payload->Data);
                    if(payload->IsDelivery()&&std::find(c.variables.begin(),c.variables.end(),variable)==c.variables.end())
                    {exposeVariable=variable;exposeTarget=0;exposePinned=pinned;}
                }
                ImGui::EndDragDropTarget();
            }
            ImGui::PopID();
        }
    }
    if(toggleVariable)SetParameterPinned(c,toggleVariable,pinDestination);
    else
    {
        if(exposeVariable)ExposeVariable(exposeVariable,c.id);
        if(exposeVariable&&exposeTarget==0&&exposePinned)SetParameterPinned(c,exposeVariable,true);
        if(exposeTarget)moveVariable=exposeVariable;
        if(moveVariable)MoveParameter(c,moveVariable,moveTarget,moveSide,moveDestination);
    }
}

void NodrecUi::DrawOverview()
{
    auto& b=Active();
    const int columns=ImGui::GetContentRegionAvail().x<900?1:2;
    if(ImGui::BeginTable("OverviewCards",columns,ImGuiTableFlags_SizingStretchProp|ImGuiTableFlags_BordersInnerV))
    {
        for(std::size_t i=0;i<b.cards.size();++i)
        {
            if(i%columns==0)ImGui::TableNextRow();ImGui::TableSetColumnIndex(static_cast<int>(i%columns));
            auto& c=b.cards[i];ImGui::PushID(c.id);
            const int pinnedRows=static_cast<int>(std::count_if(c.rows.begin(),c.rows.end(),[](const LayoutRow& r){return r.pinned;}));
            const ImGuiStyle& style=ImGui::GetStyle();
            const float frameHeight=ImGui::GetFrameHeight();
            const float tileHeight=ParameterTileHeight();
            const float cardHeight=frameHeight+style.ItemSpacing.y*3+style.WindowPadding.y*2+8.0f+pinnedRows*(tileHeight+style.ItemSpacing.y*2);
            ImGui::BeginChild("Card",ImVec2(0,cardHeight),true,ImGuiWindowFlags_AlwaysUseWindowPadding|ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoScrollWithMouse);
            ImGui::Text("%s",c.name.c_str());ImGui::SameLine(ImGui::GetContentRegionAvail().x-25);
            if(ImGui::SmallButton(UiText::More))b.detailCard=c.id;
            ImGui::Separator();DrawCardContents(c,false,false);
            if(c.id==6&&ImGui::Button(UiText::ReplayAndVerify)){}
            ImGui::EndChild();ImGui::PopID();
        }
        ImGui::EndTable();
    }
    if(b.detailCard)
    {
        bool open=true;ImGui::SetNextWindowSize(ImVec2(S(680,1),S(550,1)),ImGuiCond_FirstUseEver);
        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(),ImGuiCond_Appearing,ImVec2(.5f,.5f));
        if(!ImGui::Begin(UiText::CardDetails,&open,ImGuiWindowFlags_NoCollapse|ImGuiWindowFlags_NoTitleBar)){ImGui::End();}
        else
        {
            auto* c=b.FindCard(b.detailCard);
            if(c)
            {
                ImGui::Text("%s",c->name.c_str());
                const float right=ImGui::GetWindowWidth()-ImGui::GetStyle().WindowPadding.x;
                const float closeWidth=ImGui::CalcTextSize(UiText::Close).x+ImGui::GetStyle().FramePadding.x*2;
                const float editWidth=ImGui::CalcTextSize(UiText::EditLayout).x+ImGui::GetStyle().FramePadding.x*2;
                const float closeX=right-closeWidth,editX=closeX-ImGui::GetStyle().ItemSpacing.x-editWidth;
                if(editX>ImGui::GetCursorPosX())ImGui::SameLine(editX);else ImGui::NewLine();
                if(ImGui::Button(UiText::EditLayout)){OpenEditorTab(b,TabKind::Card,c->id);b.detailCard=0;}
                ImGui::SameLine(closeX);if(ImGui::Button(UiText::Close))open=false;
                ImGui::Separator();DrawCardContents(*c,true,false);
            }
            ImGui::End();
        }
        if(!open)b.detailCard=0;
    }
}

void NodrecUi::AddFolder(const std::string& section)
{
    auto& b=Active();
    if(_stricmp(section.c_str(),"events")==0){b.eventFolders.push_back({UiText::NewFolder,{}});b.selection={"folder",0,0,"events",static_cast<int>(b.eventFolders.size()-1)};}
    else if(_stricmp(section.c_str(),"functions")==0){b.functionFolders.push_back({UiText::NewFolder,{}});b.selection={"folder",0,0,"functions",static_cast<int>(b.functionFolders.size()-1)};}
    else if(_stricmp(section.c_str(),"variables")==0){b.variableFolders.push_back({UiText::NewFolder,{}});b.selection={"folder",0,0,"variables",static_cast<int>(b.variableFolders.size()-1)};}
    else {ParameterCard c;c.id=b.nextCard++;c.name=UiText::NewFolder;b.cards.push_back(c);b.selection={"card",c.id};}
}
void NodrecUi::ExposeVariable(int variableId,int cardId)
{
    auto& b=Active();auto* c=b.FindCard(cardId);if(!c||!b.FindVariable(variableId))return;
    if(!ExposeParameter(*c,variableId))return;
    b.selection={"parameter",variableId,cardId};
}
void NodrecUi::AddItem(const char* section,const char* kind)
{
    auto& b=Active();const std::string s=section;
    if(std::strcmp(kind,"folder")==0){AddFolder(s);return;}
    if(std::strcmp(section,"events")==0)
    {const int id=100+static_cast<int>(b.events.size());b.events.push_back({id,UiText::NewEvent});if(b.eventFolders.empty())AddFolder(section);b.eventFolders.front().items.push_back(id);b.selection={"event",id};}
    else if(std::strcmp(section,"functions")==0)
    {const int id=200+static_cast<int>(b.functions.size());b.functions.push_back({id,UiText::NewFunction});if(b.functionFolders.empty())AddFolder(section);b.functionFolders.front().items.push_back(id);b.selection={"function",id};}
    else if(std::strcmp(section,"variables")==0)
    {
        const int id=b.nextVariable++;b.variables.push_back(MakeVariable(id,"NewVariable",UiText::NewVariable,"",VariableType::Text));
        if(b.variableFolders.empty())b.variableFolders.push_back({UiText::Variables,{}});b.variableFolders.front().items.push_back(id);b.selection={"variable",id};
    }
}

void NodrecUi::DrawSection(const char* title,const char* sectionId,std::vector<TreeFolder>& folders,const char* itemKind,const char* itemLabel)
{
    auto& b=Active();ImGui::PushID(sectionId);ImGui::AlignTextToFramePadding();ImGui::TextDisabled("%s",title);ImGui::SameLine(ImGui::GetContentRegionAvail().x-20);
    if(ImGui::SmallButton("+"))ImGui::OpenPopup("AddItem");
    if(ImGui::BeginPopup("AddItem"))
    {
        if(ImGui::MenuItem(UiText::Folder))AddItem(sectionId,"folder");
        if(ImGui::MenuItem(itemLabel))AddItem(sectionId,"item");
        ImGui::EndPopup();
    }
    ImGui::Separator();
    const char* payloadType=std::strcmp(sectionId,"events")==0?"NODREC_EVENT":std::strcmp(sectionId,"functions")==0?"NODREC_FUNCTION":"NODREC_VARIABLE";
    for(std::size_t fi=0;fi<folders.size();++fi)
    {
        auto& folder=folders[fi];ImGui::PushID(static_cast<int>(fi));ImGui::AlignTextToFramePadding();
        if(ImGui::SmallButton(OpenFolder(sectionId,static_cast<int>(fi))?"v":">"))ToggleFolder(sectionId,static_cast<int>(fi));
        ImGui::SameLine();
        const bool selected=b.selection.kind=="folder"&&b.selection.folderKind==sectionId&&b.selection.folder==static_cast<int>(fi);
        if(selected)ImGui::PushStyleColor(ImGuiCol_Button,ImVec4(.18f,.31f,.48f,1));
        if(ImGui::SmallButton(folder.name.c_str()))b.selection={"folder",0,0,sectionId,static_cast<int>(fi)};
        if(selected)ImGui::PopStyleColor();
        if(ImGui::BeginDragDropTarget())
        {
            if(const ImGuiPayload* payload=ImGui::AcceptDragDropPayload(payloadType))
            {
                if(payload->IsDelivery())
                {
                    const int id=*static_cast<const int*>(payload->Data);
                    for(auto& group:folders)group.items.erase(std::remove(group.items.begin(),group.items.end(),id),group.items.end());
                    folder.items.push_back(id);
                }
            }
            ImGui::EndDragDropTarget();
        }
        if(OpenFolder(sectionId,static_cast<int>(fi)))
        {
            ImGui::Indent(S(16,1));
            for(int item:folder.items)
            {
                char label[160]={};if(!ItemName(b,sectionId,item,label,sizeof(label)))continue;
                ImGui::PushID(item);
                const bool active=b.selection.kind==itemKind&&b.selection.id==item;
                if(active)ImGui::PushStyleColor(ImGuiCol_Button,ImVec4(.18f,.31f,.48f,1));
                if(ImGui::Selectable(label,active)){b.selection.kind=itemKind;b.selection.id=item;}
                if(active)ImGui::PopStyleColor();
                if(ImGui::BeginDragDropSource())
                {ImGui::SetDragDropPayload(payloadType,&item,sizeof(item));ImGui::TextUnformatted(label);ImGui::EndDragDropSource();}
                ImGui::PopID();
            }
            ImGui::Unindent(S(16,1));
        }
        ImGui::PopID();
    }
    ImGui::PopID();
}

void NodrecUi::DrawParameterSection()
{
    auto& b=Active();
    ImGui::PushID("parameters");
    ImGui::TextDisabled(UiText::Parameters);
    ImGui::SameLine(ImGui::GetContentRegionAvail().x-20);
    if(ImGui::SmallButton("+"))ImGui::OpenPopup("AddParameter");
    if(ImGui::BeginPopup("AddParameter"))
    {
        if(ImGui::MenuItem(UiText::Folder))AddFolder("parameters");
        if(ImGui::BeginMenu(UiText::ParameterFromVariable))
        {
            for(auto& card:b.cards)
            {
                if(!ImGui::BeginMenu(card.name.c_str()))continue;
                for(auto& variable:b.variables)
                    if(std::find(card.variables.begin(),card.variables.end(),variable.id)==card.variables.end()&&ImGui::MenuItem(variable.name.c_str()))
                        ExposeVariable(variable.id,card.id);
                ImGui::EndMenu();
            }
            ImGui::EndMenu();
        }
        ImGui::EndPopup();
    }
    ImGui::Separator();
    for(std::size_t i=0;i<b.cards.size();++i)
    {
        auto& card=b.cards[i];
        ImGui::PushID(card.id);
        if(ImGui::SmallButton(OpenFolder("parameters",static_cast<int>(i))?"v":">"))ToggleFolder("parameters",static_cast<int>(i));
        ImGui::SameLine();
        if(ImGui::Selectable(card.name.c_str(),b.selection.kind=="card"&&b.selection.id==card.id))
        {
            b.selection={"card",card.id};
            if(ImGui::IsMouseDoubleClicked(0))OpenEditorTab(b,TabKind::Card,card.id);
        }
        if(ImGui::BeginDragDropTarget())
        {
            if(const ImGuiPayload* payload=ImGui::AcceptDragDropPayload("NODREC_VARIABLE"))
                if(payload->IsDelivery())ExposeVariable(*static_cast<const int*>(payload->Data),card.id);
            ImGui::EndDragDropTarget();
        }
        if(OpenFolder("parameters",static_cast<int>(i)))
        {
            ImGui::Indent();
            for(int id:card.variables)
            {
                auto* variable=b.FindVariable(id);auto* row=FindRow(card,id);if(!variable||!row)continue;
                ImGui::PushID(id);
                if(ImGui::Selectable(variable->label.c_str(),b.selection.kind=="parameter"&&b.selection.id==id&&b.selection.card==card.id))b.selection={"parameter",id,card.id};
                if(ImGui::BeginDragDropSource())
                {int payload[2]={card.id,id};ImGui::SetDragDropPayload("NODREC_PARAMETER",payload,sizeof(payload));ImGui::TextUnformatted(variable->label.c_str());ImGui::EndDragDropSource();}
                ImGui::SameLine();if(DrawPinButton("pin",row->pinned))SetParameterPinned(card,id,!row->pinned);
                ImGui::PopID();
            }
            ImGui::Unindent();
        }
        ImGui::PopID();
    }
    ImGui::PopID();
}

void NodrecUi::DrawLibrary()
{
    auto& b=Active();DrawSection(UiText::Events,"events",b.eventFolders,"event",UiText::Event);DrawSection(UiText::Functions,"functions",b.functionFolders,"function",UiText::Function);DrawParameterSection();DrawSection(UiText::Variables,"variables",b.variableFolders,"variable",UiText::Variable);
}

void NodrecUi::DrawGraph(ed::EditorContext* editor,float dpiScale,std::string& feedback)
{
    auto& b=Active();auto& graph=b.graph;
    const bool firstView=graphLayoutBlueprint!=b.id;
    if(firstView)
    {
        ed::SetCurrentEditor(editor);ed::ClearSelection();
        for(const auto& node:graph.nodes)ed::SetNodePosition(ed::NodeId(node.id),ImVec2(node.x*dpiScale,node.y*dpiScale));
        if(b.selection.kind=="node"&&graph.FindNode(b.selection.id))ed::SelectNode(ed::NodeId(b.selection.id));
        ed::SetCurrentEditor(nullptr);graphLayoutBlueprint=b.id;
    }
    ImGui::BeginChild("GraphTools",ImVec2(0,S(44,dpiScale)),false);
    if(ImGui::Button(UiText::AddNode))ImGui::OpenPopup("NodeDirectory");
    if(ImGui::BeginPopup("NodeDirectory"))
    {
        std::size_t nodeCount=0;const NodeDefinition* catalog=GetNodeCatalog(nodeCount);
        for(std::size_t i=0;i<nodeCount;++i)if(ImGui::MenuItem(catalog[i].title))
        {
            const float x=40+static_cast<float>(graph.nodes.size()%3)*260,y=70+static_cast<float>(graph.nodes.size()/3)*190;
            const int id=graph.AddNode(catalog[i].kind,x,y);ed::SetCurrentEditor(editor);ed::SetNodePosition(ed::NodeId(id),ImVec2(x*dpiScale,y*dpiScale));ed::SelectNode(ed::NodeId(id));ed::SetCurrentEditor(nullptr);b.selection={"node",id};
        }
        ImGui::EndPopup();
    }
    ImGui::SameLine();if(ImGui::Button(UiText::FitGraph)){ed::SetCurrentEditor(editor);ed::NavigateToContent(.2f);ed::SetCurrentEditor(nullptr);}
    ImGui::SameLine();ImGui::TextDisabled(UiText::GraphHelp);
    ImGui::EndChild();
    ed::SetCurrentEditor(editor);ed::Begin("Blueprint canvas");
    util::BlueprintNodeBuilder builder;
    for(auto& node:graph.nodes)
    {
        const ImVec4 head=node.kind==NodeKind::StartEvent?ImVec4(.40f,.20f,.26f,1):node.kind==NodeKind::CaptureScreen||node.kind==NodeKind::CaptureAudio||node.kind==NodeKind::SelectRegion?ImVec4(.16f,.29f,.42f,1):node.kind==NodeKind::Encode?ImVec4(.26f,.23f,.38f,1):ImVec4(.31f,.27f,.20f,1);
        builder.Begin(ed::NodeId(node.id));builder.Header(head);ImGui::Text("%s",node.name.c_str());builder.EndHeader();
        for(auto& pin:graph.pins)if(pin.node==node.id&&!pin.output){builder.Input(ed::PinId(pin.id));ImGui::TextColored(PinColor(pin.type),"o");ImGui::SameLine();ImGui::TextUnformatted(pin.label.c_str());builder.EndInput();}
        builder.Middle();
        if(node.kind==NodeKind::SelectRegion)
        {if(ImGui::Button(UiText::SelectRegion)){}ImGui::TextDisabled(UiText::SelectRegionHint);}
        if(node.kind==NodeKind::CaptureScreen||node.kind==NodeKind::CaptureAudio)
        {
            bool& recording=node.kind==NodeKind::CaptureScreen?b.screenRecording:b.audioRecording;
            bool& paused=node.kind==NodeKind::CaptureScreen?b.screenPaused:b.audioPaused;
            if(ImGui::SmallButton(recording?UiText::RecordingActive:UiText::StartRecording)){recording=true;paused=false;}ImGui::SameLine();
            ImGui::BeginDisabled(!recording);if(ImGui::SmallButton(paused?UiText::Resume:UiText::Pause))paused=!paused;ImGui::SameLine();if(ImGui::SmallButton(UiText::Stop)){recording=false;paused=false;}ImGui::EndDisabled();
            ImGui::TextDisabled("%s",recording?(paused?UiText::Paused:UiText::RecordingStatus):UiText::Ready);
        }
        if(node.kind==NodeKind::Encode)ImGui::TextDisabled(UiText::MediaOutputExample);
        if(node.kind==NodeKind::Write)ImGui::TextDisabled(UiText::OutputPathExample);
        if(node.kind==NodeKind::TextNode)ImGui::TextDisabled(UiText::TextUtilityExample);
        for(auto& pin:graph.pins)if(pin.node==node.id&&pin.output){builder.Output(ed::PinId(pin.id));ImGui::TextUnformatted(pin.label.c_str());ImGui::SameLine();ImGui::TextColored(PinColor(pin.type),"o");builder.EndOutput();}
        builder.End();
        if(ImGui::IsItemVisible())node.x=ed::GetNodePosition(ed::NodeId(node.id)).x/dpiScale,node.y=ed::GetNodePosition(ed::NodeId(node.id)).y/dpiScale;
    }
    for(const auto& link:graph.links){const auto* pin=graph.FindPin(link.from);if(pin)ed::Link(ed::LinkId(link.id),ed::PinId(link.from),ed::PinId(link.to),PinColor(pin->type),2.0f);}
    if(ed::BeginCreate())
    {
        ed::PinId first,second;
        if(ed::QueryNewLink(&first,&second)&&first&&second)
        {
            auto candidate=graph;feedback=candidate.AddLink(static_cast<int>(first.Get()),static_cast<int>(second.Get()));
            if(feedback.empty()&&ed::AcceptNewItem()){graph.links=std::move(candidate.links);graph.nextLink=candidate.nextLink;feedback=UiText::LinkCreated;}
            else if(!feedback.empty())ed::RejectNewItem(ImColor(230,80,80),3);
        }
    }
    ed::EndCreate();
    if(ed::BeginDelete())
    {
        ed::LinkId link;while(ed::QueryDeletedLink(&link))if(ed::AcceptDeletedItem()){graph.RemoveLink(static_cast<int>(link.Get()));feedback=UiText::LinkDeleted;}
        ed::NodeId node;while(ed::QueryDeletedNode(&node))if(ed::AcceptDeletedItem()){graph.RemoveNode(static_cast<int>(node.Get()));if(b.selection.kind=="node"&&b.selection.id==static_cast<int>(node.Get()))b.selection={"none",0};}
    }
    ed::EndDelete();
    ed::NodeId selected[4];const int count=ed::GetSelectedNodes(selected,4);if(count>0)b.selection={"node",static_cast<int>(selected[0].Get())};
    else if(b.selection.kind=="node")b.selection={"none",0};
    if(firstView)ed::NavigateToContent(.2f);
    ed::End();ed::SetCurrentEditor(nullptr);
}

void NodrecUi::DrawCardEditor()
{
    auto& b=Active();auto* tab=b.ActiveTab();auto* c=tab?b.FindCard(tab->card):nullptr;if(!c)return;
    DrawCardContents(*c,true,true);
}

void NodrecUi::DrawDetails(ed::EditorContext* editor)
{
    auto& b=Active();auto s=b.selection;
    ImGui::TextUnformatted(UiText::Details);ImGui::Separator();
    if(s.kind=="node")
    {
        auto* node=b.graph.FindNode(s.id);if(!node){ImGui::TextDisabled(UiText::SelectNodeHint);return;}
        ImGui::TextDisabled(UiText::Name);char name[128];std::snprintf(name,sizeof(name),"%s",node->name.c_str());if(ImGui::InputText("##nodeName",name,sizeof(name)))node->name=name;
        ImGui::TextDisabled(UiText::NodeDetailsFormat,KindLabel(node->kind));ImGui::Text(UiText::PositionFormat,node->x,node->y);
        if(node->kind==NodeKind::SelectRegion){ImGui::TextUnformatted(UiText::ScreenRegionDetail);ImGui::TextUnformatted(UiText::RegionValue);}
        if(node->kind==NodeKind::CaptureScreen||node->kind==NodeKind::CaptureAudio)ImGui::TextDisabled(UiText::CaptureStateSimulated);
        if(ImGui::Button(UiText::DeleteNode))
        {
            const int id=node->id;b.graph.RemoveNode(id);b.selection={"none",0};
            if(editor){ed::SetCurrentEditor(editor);ed::DeselectNode(ed::NodeId(id));ed::SetCurrentEditor(nullptr);}
        }
        if(editor&&ImGui::Button(UiText::FitGraph)){ed::SetCurrentEditor(editor);ed::NavigateToContent(.2f);ed::SetCurrentEditor(nullptr);}
    }
    else if(s.kind=="card")
    {
        auto* c=b.FindCard(s.id);if(!c)return;ImGui::TextDisabled(UiText::CardName);char name[128];std::snprintf(name,sizeof(name),"%s",c->name.c_str());if(ImGui::InputText("##cardName",name,sizeof(name)))c->name=name;
        ImGui::Text(UiText::ParameterCountFormat,static_cast<int>(c->variables.size()));
        if(ImGui::Button(UiText::OpenCardEditor))OpenEditorTab(b,TabKind::Card,c->id);
    }
    else if(s.kind=="parameter"||s.kind=="variable"||s.kind=="newParameter")
    {
        if(s.kind=="newParameter")
        {
            auto* c=b.FindCard(s.card);if(!c)return;
            for(auto& v:b.variables)if(std::find(c->variables.begin(),c->variables.end(),v.id)==c->variables.end())
                if(ImGui::Button((std::string(UiText::AddPrefix)+v.label).c_str()))ExposeVariable(v.id,c->id);
            return;
        }
        auto* v=b.FindVariable(s.id);if(!v)return;
        ImGui::TextDisabled(UiText::Name);char name[128];std::snprintf(name,sizeof(name),"%s",v->name.c_str());if(ImGui::InputText("##variableName",name,sizeof(name)))v->name=name;
        ImGui::Text(UiText::TypeFormat,v->type==VariableType::Boolean?UiText::Boolean:v->type==VariableType::Choice?UiText::Choice:v->type==VariableType::Readonly?UiText::OutputType:UiText::Text);
        if(s.kind=="parameter")
        {
            auto* c=b.FindCard(s.card);auto* row=c?FindRow(*c,v->id):nullptr;if(!c||!row)return;
            ImGui::Text(UiText::CardNameValueFormat,c->name.c_str());bool pinned=row->pinned;
            if(ImGui::Checkbox(UiText::PinnedOnCard,&pinned)){SetParameterPinned(*c,v->id,pinned);row=FindRow(*c,v->id);if(!row)return;}
            std::vector<int> rows;for(std::size_t i=0;i<c->rows.size();++i)if(c->rows[i].pinned==row->pinned)rows.push_back(static_cast<int>(i));
            int current=0;for(std::size_t i=0;i<rows.size();++i)if(&c->rows[rows[i]]==row)current=static_cast<int>(i);
            int moveTarget=0;bool moveRow=false;
            ImGui::TextDisabled(UiText::LayoutRow);
            if(ImGui::BeginCombo("##layoutRow",(std::string(UiText::RowPrefix)+std::to_string(current+1)).c_str()))
            {
                for(std::size_t i=0;i<rows.size();++i)
                    if(i!=static_cast<std::size_t>(current)&&ImGui::Selectable((std::string(UiText::RowPrefix)+std::to_string(i+1)).c_str()))
                    {moveTarget=c->rows[rows[i]].columns.back().variable;moveRow=true;}
                if(ImGui::Selectable(UiText::NewRowAtEnd))moveRow=true;
                ImGui::EndCombo();
            }
            if(moveRow){MoveParameter(*c,v->id,moveTarget,moveTarget?"right":"below",row->pinned);row=FindRow(*c,v->id);if(!row)return;}
            auto col=std::find_if(row->columns.begin(),row->columns.end(),[&](const LayoutColumn& x){return x.variable==v->id;});
            if(col!=row->columns.end()&&row->columns.size()>1)
            {ImGui::TextDisabled(UiText::ColumnWidth);float pct=col->weight*100;if(ImGui::SliderFloat("##columnWidth",&pct,10,90,UiText::PercentageFormat))SetColumnWeight(*row,v->id,pct);}
        }
        else ImGui::TextDisabled(UiText::DragVariableHint);
    }
    else if(s.kind=="event"||s.kind=="function")
    {
        auto& items=s.kind=="event"?b.events:b.functions;
        ImGui::TextDisabled(s.kind=="event"?UiText::EventName:UiText::FunctionName);
        for(auto& item:items)if(item.first==s.id){char name[128];std::snprintf(name,sizeof(name),"%s",item.second.c_str());if(ImGui::InputText("##itemName",name,sizeof(name)))item.second=name;break;}
        if(s.kind=="event")ImGui::TextDisabled(UiText::EventMetadataHint);else ImGui::TextDisabled(UiText::FunctionMetadataHint);
    }
    else if(s.kind=="folder")
    {
        auto& folders=s.folderKind=="events"?b.eventFolders:s.folderKind=="functions"?b.functionFolders:b.variableFolders;
        if(s.folder>=0&&s.folder<static_cast<int>(folders.size())){ImGui::TextDisabled(UiText::FolderName);char name[128];std::snprintf(name,sizeof(name),"%s",folders[s.folder].name.c_str());if(ImGui::InputText("##folderName",name,sizeof(name)))folders[s.folder].name=name;}
    }
    else if(s.kind=="newBlueprint")ImGui::TextDisabled(UiText::NewBlueprintHint);
    else ImGui::TextDisabled(UiText::SelectItemHint);
}

void NodrecUi::DrawEditor(ed::EditorContext* editor,float dpiScale,std::string& feedback)
{
    auto& b=Active();auto* tab=b.ActiveTab();if(!tab)return;
    if(tab->kind==TabKind::Overview){DrawOverview();return;}
    const float avail=ImGui::GetContentRegionAvail().x;const float side=S(210,dpiScale),detail=S(230,dpiScale);
    const float horizontalMinimum=side+detail+S(400,dpiScale)+ImGui::GetStyle().ItemSpacing.x*2;
    if(avail>=horizontalMinimum)
    {
        ImGui::BeginChild("BlueprintLibrary",ImVec2(side,0),true);DrawLibrary();ImGui::EndChild();ImGui::SameLine();
        ImGui::BeginChild("BlueprintWork",ImVec2(-detail,0),false);
        if(tab->kind==TabKind::Blueprint)DrawGraph(editor,dpiScale,feedback);else DrawCardEditor();
        ImGui::EndChild();ImGui::SameLine();ImGui::BeginChild("BlueprintDetails",ImVec2(0,0),true);DrawDetails(editor);ImGui::EndChild();
    }
    else
    {
        ImGui::BeginChild("BlueprintLibraryCompact",ImVec2(0,S(190,dpiScale)),true);DrawLibrary();ImGui::EndChild();
        ImGui::BeginChild("BlueprintWorkCompact",ImVec2(0,S(430,dpiScale)),true);
        if(tab->kind==TabKind::Blueprint)DrawGraph(editor,dpiScale,feedback);else DrawCardEditor();ImGui::EndChild();
        ImGui::BeginChild("BlueprintDetailsCompact",ImVec2(0,0),true);DrawDetails(editor);ImGui::EndChild();
    }
}

void NodrecUi::Draw(ed::EditorContext* editor,float dpiScale,std::string& feedback)
{
    const auto* viewport=ImGui::GetMainViewport();ImGui::SetNextWindowPos(viewport->WorkPos);ImGui::SetNextWindowSize(viewport->WorkSize);
    ImGui::Begin("Nodrec",nullptr,ImGuiWindowFlags_NoDecoration|ImGuiWindowFlags_NoSavedSettings);
    auto& b=Active();
    ImGui::BeginChild("Titlebar",ImVec2(0,S(42,dpiScale)),false);ImGui::TextDisabled(UiText::Brand);ImGui::SameLine(ImGui::GetWindowWidth()*.5f-ImGui::CalcTextSize(b.name.c_str()).x*.5f);ImGui::Text("%s",b.name.c_str());ImGui::EndChild();
    ImGui::BeginChild("BlueprintSidebar",ImVec2(S(220,dpiScale),0),true);DrawBlueprintList();ImGui::EndChild();ImGui::SameLine();
    ImGui::BeginChild("BlueprintProject",ImVec2(0,0),false);
    DrawMasterBar();DrawTabs();DrawEditor(editor,dpiScale,feedback);
    ImGui::EndChild();ImGui::End();
}


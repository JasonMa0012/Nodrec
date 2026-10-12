#pragma once

#include <algorithm>
#include <string>
#include <vector>
#include "ui_text.h"

enum class PinType { Flow, Video, Audio, Integer, Rect, EncodedVideo, Path, Text };
enum class NodeKind { StartEvent, SelectRegion, CaptureScreen, CaptureAudio, Encode, Write, TextNode };

struct NodeDefinition { NodeKind kind; const char* title; };

inline const NodeDefinition* GetNodeCatalog(std::size_t& count)
{
    static const NodeDefinition catalog[] = {
        {NodeKind::StartEvent,UiText::OnStartRecording},
        {NodeKind::SelectRegion,UiText::SelectScreenRegion},
        {NodeKind::CaptureScreen,UiText::CaptureScreen},
        {NodeKind::CaptureAudio,UiText::CaptureAudio},
        {NodeKind::Encode,UiText::EncodeVideo},
        {NodeKind::Write,UiText::WriteOutput},
        {NodeKind::TextNode,UiText::MakeUniquePath}
    };
    count=sizeof(catalog)/sizeof(catalog[0]);return catalog;
}

inline const NodeDefinition* FindNodeDefinition(NodeKind kind)
{
    std::size_t count=0;const auto* catalog=GetNodeCatalog(count);
    for(std::size_t i=0;i<count;++i)if(catalog[i].kind==kind)return &catalog[i];
    return nullptr;
}

struct Pin
{
    int id;
    int node;
    PinType type;
    bool output;
    std::string label;
};

struct Link { int id; int from; int to; };

struct PrototypeNode
{
    int id = 0;
    NodeKind kind = NodeKind::TextNode;
    std::string name;
    float x = 0;
    float y = 0;
    bool expanded = true;
    std::string status = UiText::Ready;
};

struct PrototypeGraph
{
    std::vector<PrototypeNode> nodes;
    std::vector<Pin> pins;
    std::vector<Link> links;
    int nextNode = 1;
    int nextPin = 701;
    int nextLink = 1001;

    PrototypeGraph()
    {
        AddNode(NodeKind::StartEvent, 35, 40);
        AddNode(NodeKind::SelectRegion, 35, 230);
        AddNode(NodeKind::CaptureScreen, 355, 40);
        AddNode(NodeKind::CaptureAudio, 355, 330);
        AddNode(NodeKind::Encode, 690, 90);
        AddNode(NodeKind::Write, 1010, 140);
        AddLink(101, 301); AddLink(201, 302); AddLink(303, 501);
        AddLink(402, 502); AddLink(503, 601);
    }

    PrototypeNode* FindNode(int id)
    {
        auto it = std::find_if(nodes.begin(), nodes.end(), [id](const PrototypeNode& n) { return n.id == id; });
        return it == nodes.end() ? nullptr : &*it;
    }

    const PrototypeNode* FindNode(int id) const
    {
        auto it = std::find_if(nodes.begin(), nodes.end(), [id](const PrototypeNode& n) { return n.id == id; });
        return it == nodes.end() ? nullptr : &*it;
    }

    Pin* FindPin(int id)
    {
        auto it = std::find_if(pins.begin(), pins.end(), [id](const Pin& p) { return p.id == id; });
        return it == pins.end() ? nullptr : &*it;
    }

    const Pin* FindPin(int id) const
    {
        auto it = std::find_if(pins.begin(), pins.end(), [id](const Pin& p) { return p.id == id; });
        return it == pins.end() ? nullptr : &*it;
    }

    int AddNode(NodeKind kind, float x, float y)
    {
        const int id = nextNode++;
        const auto* definition=FindNodeDefinition(kind);
        nodes.push_back({id, kind, definition?definition->title:UiText::Text, x, y});
        int ordinal = 1;
        auto add = [this, id, &ordinal](PinType type, bool output, const char* label)
        {
            const int pinId = id <= 6 ? id * 100 + ordinal++ : nextPin++;
            pins.push_back({pinId, id, type, output, label});
        };
        switch (kind)
        {
        case NodeKind::StartEvent: add(PinType::Flow, true, UiText::Then); break;
        case NodeKind::SelectRegion: add(PinType::Rect, true, UiText::DisplayRegion); break;
        case NodeKind::CaptureScreen:
            add(PinType::Flow, false, UiText::Execute); add(PinType::Rect, false, UiText::Region); add(PinType::Video, true, UiText::Frames); break;
        case NodeKind::CaptureAudio:
            add(PinType::Flow, false, UiText::Execute); add(PinType::Audio, true, UiText::Audio); break;
        case NodeKind::Encode:
            add(PinType::Video, false, UiText::Frames); add(PinType::Audio, false, UiText::Audio); add(PinType::EncodedVideo, true, UiText::Video); break;
        case NodeKind::Write:
            add(PinType::EncodedVideo, false, UiText::Video); add(PinType::Path, false, UiText::Path); break;
        case NodeKind::TextNode: add(PinType::Text, true, UiText::Text); break;
        }
        return id;
    }

    std::string AddLink(int first, int second)
    {
        const auto* from = FindPin(first); const auto* to = FindPin(second);
        if (!from || !to) return UiText::UnknownPin;
        if (!from->output) std::swap(from, to);
        if (!from->output || to->output) return UiText::ConnectOutputToInput;
        if (from->node == to->node) return UiText::CannotConnectSelf;
        if (from->type != to->type) return UiText::PinTypesDoNotMatch;
        for (const auto& link : links)
        {
            if (link.to == to->id) return UiText::InputAlreadyConnected;
            if (link.from == from->id && link.to == to->id) return UiText::LinkAlreadyExists;
        }
        links.push_back({nextLink++, from->id, to->id});
        return {};
    }

    void RemoveLink(int id)
    {
        links.erase(std::remove_if(links.begin(), links.end(), [id](const Link& link) { return link.id == id; }), links.end());
    }

    bool RemoveNode(int id)
    {
        if (!FindNode(id)) return false;
        nodes.erase(std::remove_if(nodes.begin(), nodes.end(), [id](const PrototypeNode& n) { return n.id == id; }), nodes.end());
        pins.erase(std::remove_if(pins.begin(), pins.end(), [id](const Pin& p) { return p.node == id; }), pins.end());
        links.erase(std::remove_if(links.begin(), links.end(), [this](const Link& l)
        {
            const auto* from = FindPin(l.from); const auto* to = FindPin(l.to);
            return !from || !to;
        }), links.end());
        return true;
    }
};

inline bool CheckPrototypeGraph()
{
    PrototypeGraph graph;
    if (graph.nodes.size() != 6 || graph.links.size() != 5) return false;
    if (graph.AddLink(999, 301).empty()) return false;
    if (graph.AddLink(101, 201).empty()) return false;
    if (graph.AddLink(201, 301).empty()) return false;
    if (graph.AddLink(303, 301).empty()) return false;
    if (graph.AddLink(101, 301).empty()) return false;
    if (graph.AddLink(101, 301).empty()) return false;
    graph.RemoveLink(1001);
    if (!graph.AddLink(301, 101).empty()) return false;
    const int node = graph.AddNode(NodeKind::TextNode, 50, 50);
    const int pin = graph.pins.back().id;
    if (!graph.RemoveNode(node) || graph.FindPin(pin)) return false;
    if (!graph.RemoveNode(3) || graph.links.size()!=2) return false;
    for (const auto& link : graph.links)
        if (!graph.FindPin(link.from) || !graph.FindPin(link.to)) return false;
    return graph.nodes.size() == 5;
}

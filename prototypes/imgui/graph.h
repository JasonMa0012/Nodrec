#pragma once
#include <algorithm>
#include <array>
#include <string>
#include <vector>

enum class PinType { Video, Integer, EncodedVideo, Path };
struct Pin { int id; int node; PinType type; bool output; const char* label; };
struct Link { int id; int from; int to; };

struct PrototypeGraph
{
    // shortcut: fixed nodes for UI validation, replace when workflow creation is implemented.
    const std::array<Pin, 8> pins{{
        {101, 1, PinType::Video, true, "Video"},
        {201, 2, PinType::Integer, true, "FPS"},
        {301, 3, PinType::Video, false, "Video"},
        {302, 3, PinType::Integer, false, "FPS"},
        {303, 3, PinType::EncodedVideo, true, "Encoded video"},
        {401, 4, PinType::Path, true, "Path"},
        {501, 5, PinType::EncodedVideo, false, "Encoded video"},
        {502, 5, PinType::Path, false, "Path"}
    }};
    std::vector<Link> links{{1001, 101, 301}, {1002, 201, 302},
                            {1003, 303, 501}, {1004, 401, 502}};
    int nextLink = 1005;
    int fps = 30;
    bool showCursor = true;
    char outputPath[256] = "C:/Recordings";

    const Pin* FindPin(int id) const
    {
        const auto it = std::find_if(pins.begin(), pins.end(),
                                    [id](const Pin& pin) { return pin.id == id; });
        return it == pins.end() ? nullptr : &*it;
    }

    std::string AddLink(int first, int second)
    {
        const auto* from = FindPin(first);
        const auto* to = FindPin(second);
        if (!from || !to) return "Unknown pin";
        if (!from->output) std::swap(from, to);
        if (!from->output || to->output) return "Connect an output to an input";
        if (from->node == to->node) return "Cannot connect a node to itself";
        if (from->type != to->type) return "Pin types do not match";
        for (const auto& link : links)
            if (link.to == to->id) return "Input already connected; delete its link first";
        links.push_back({nextLink++, from->id, to->id});
        return {};
    }

    void RemoveLink(int id)
    {
        links.erase(std::remove_if(links.begin(), links.end(),
                                  [id](const Link& link) { return link.id == id; }), links.end());
    }
};

inline bool CheckPrototypeGraph()
{
    PrototypeGraph graph;
    const auto originalCount = graph.links.size();
    if (graph.AddLink(999, 301).empty()) return false;
    if (graph.AddLink(101, 201).empty()) return false;
    if (graph.AddLink(201, 301).empty()) return false;
    if (graph.AddLink(303, 301).empty()) return false;
    if (graph.AddLink(101, 301).empty()) return false;
    if (graph.links.size() != originalCount) return false;
    graph.RemoveLink(1001);
    if (!graph.AddLink(301, 101).empty()) return false;
    if (graph.links.back().from != 101 || graph.links.back().to != 301) return false;
    if (graph.links.size() != originalCount) return false;
    graph.RemoveLink(-1);
    return graph.links.size() == originalCount;
}

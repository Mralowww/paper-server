import Foundation
import SwiftData

enum TodoCategory: String, CaseIterable, Codable, Identifiable {
    case personal = "個人"
    case work = "工作"
    case shopping = "購物"
    case other = "其他"

    var id: String { rawValue }
}

@Model
final class TodoItem {
    var title: String
    var isCompleted: Bool
    var category: TodoCategory
    var dueDate: Date?
    var createdAt: Date

    init(
        title: String,
        isCompleted: Bool = false,
        category: TodoCategory = .personal,
        dueDate: Date? = nil,
        createdAt: Date = .now
    ) {
        self.title = title
        self.isCompleted = isCompleted
        self.category = category
        self.dueDate = dueDate
        self.createdAt = createdAt
    }
}

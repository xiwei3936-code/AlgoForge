/**
 * 随机链表的结点（LeetCode「随机链表的复制」里就叫 Node）。
 *
 * 和 ListNode / TreeNode 一样：只在学生自己没定义时才补进来，
 * 所以从 LeetCode 题面里粘一份出来也不会撞成"重复的类"。
 *
 * 判题外壳按**字段形状**认它（val + next + random），不认类名。
 */
class Node {
    int val;
    Node next;
    Node random;

    public Node(int val) {
        this.val = val;
        this.next = null;
        this.random = null;
    }
}

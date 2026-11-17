/* LeetCode 官方的单链表结点定义。判题时只有在你自己没有定义 ListNode 时才会加进来，
   所以你把 LeetCode 注释里的那段定义粘贴出来也不会撞车。 */
class ListNode {
    int val;
    ListNode next;

    ListNode() {
    }

    ListNode(int val) {
        this.val = val;
    }

    ListNode(int val, ListNode next) {
        this.val = val;
        this.next = next;
    }
}

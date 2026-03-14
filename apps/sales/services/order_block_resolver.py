def resolve_block_reasons(order):
    """
    Returns a list of human-readable reasons why a SalesOrder is blocked.
    Used for UI tooltips and backend validation.
    """
    reasons = []
    
    # 1. Check if it's a CUSTOM order awaiting engineering approval
    if order.order_type == 'CUSTOM' and order.status == 'ON_HOLD':
        # Check if items have DRAFT templates
        for item in order.items.all():
            if item.template and item.template.status == 'DRAFT':
                reasons.append(f"Custom template '{item.template.name}' is awaiting engineering approval.")
    
    # 2. Check each item for individual production blocks
    for item in order.items.all():
        if not item.template:
            reasons.append(f"Item {item.id} is missing a Template Blueprint.")
            continue
            
        # Template Status
        if item.template.status != 'LIVE':
            reasons.append(f"Template '{item.template.name}' is not LIVE (Current: {item.template.status}).")
            
        # Routing Status
        if not item.template.routing_rule:
            reasons.append(f"Manufacturing Routing not assigned for template '{item.template.name}'.")
            
        # Routing Status
        if not item.template.routing_rule:
            reasons.append(f"Manufacturing Routing not assigned for template '{item.template.name}'.")

    return list(set(reasons)) # Unique reasons


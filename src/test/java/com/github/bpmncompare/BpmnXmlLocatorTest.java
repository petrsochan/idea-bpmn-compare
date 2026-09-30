package com.github.bpmncompare;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BpmnXmlLocatorTest {

    private static final String XML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1">
              <bpmn:process id="Process_1" isExecutable="true">
                <bpmn:startEvent id="StartEvent_1" name="Start"/>
                <bpmn:serviceTask id='Task_1' name='Approve'/>
                <bpmn:sequenceFlow id = "Flow_1" sourceRef="StartEvent_1" targetRef="Task_1"/>
              </bpmn:process>
              <bpmndi:BPMNDiagram id="BPMNDiagram_1">
                <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1"/>
              </bpmndi:BPMNDiagram>
            </bpmn:definitions>
            """;

    @Test
    void findsTheOffsetOfADoubleQuotedId() {
        int offset = BpmnXmlLocator.offsetOfElement(XML, "StartEvent_1");

        assertTrue(offset > 0, "not found");
        assertTrue(XML.startsWith("<bpmn:startEvent", offset), XML.substring(offset, offset + 20));
    }

    @Test
    void findsTheOffsetOfASingleQuotedId() {
        int offset = BpmnXmlLocator.offsetOfElement(XML, "Task_1");

        assertTrue(XML.startsWith("<bpmn:serviceTask", offset), XML.substring(offset, offset + 20));
    }

    @Test
    void toleratesWhitespaceAroundTheEqualsSign() {
        int offset = BpmnXmlLocator.offsetOfElement(XML, "Flow_1");

        assertTrue(XML.startsWith("<bpmn:sequenceFlow", offset), XML.substring(offset, offset + 20));
    }

    @Test
    void doesNotMatchTheDiShapeThatOnlyReferencesTheElement() {
        // BPMNShape carries bpmnElement="Task_1" and id="Task_1_di" - the model element must win
        assertTrue(BpmnXmlLocator.offsetOfElement(XML, "Task_1") < XML.indexOf("BPMNShape"),
                "matched the diagram shape instead of the model element");
    }

    @Test
    void returnsMinusOneForAnUnknownId() {
        assertEquals(-1, BpmnXmlLocator.offsetOfElement(XML, "Nope_1"));
    }

    @Test
    void doesNotMatchAnIdThatIsOnlyAPrefixOfAnother() {
        assertEquals(-1, BpmnXmlLocator.offsetOfElement(XML, "Task_"));
        assertEquals(-1, BpmnXmlLocator.offsetOfElement(XML, "rocess_1"));
    }

    @Test
    void doesNotMatchAnotherAttributeEndingInId() {
        String xml = "<bpmn:task someId=\"Task_9\" id=\"Task_1\"/>";

        assertEquals(0, BpmnXmlLocator.offsetOfElement(xml, "Task_1"));
        assertEquals(-1, BpmnXmlLocator.offsetOfElement(xml, "Task_9"));
    }

    @Test
    void readsTheIdOfTheElementSurroundingAnOffset() {
        assertEquals("Task_1", BpmnXmlLocator.elementIdAt(XML, XML.indexOf("name='Approve'")));
        assertEquals("Process_1", BpmnXmlLocator.elementIdAt(XML, XML.indexOf("isExecutable")));
        assertEquals("Flow_1", BpmnXmlLocator.elementIdAt(XML, XML.indexOf("sourceRef")));
    }

    @Test
    void elementIdAtToleratesPositionsWithNoEnclosingElementId() {
        assertNull(BpmnXmlLocator.elementIdAt(XML, 0));
        assertNull(BpmnXmlLocator.elementIdAt("", 0));
        assertNull(BpmnXmlLocator.elementIdAt("no tags here", 5));
    }

    @Test
    void elementIdAtClampsAnOffsetPastTheEnd() {
        assertEquals("Definitions_1", BpmnXmlLocator.elementIdAt("<bpmn:definitions id=\"Definitions_1\">", 9999));
    }
}
